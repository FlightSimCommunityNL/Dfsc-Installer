import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import { request } from 'undici'
import extractZip from 'extract-zip'
import fse from 'fs-extra'

import type { InstallProgressEvent, ManifestAddon, ManifestAddonChannel } from '@shared/types'
import { getTempBaseDir, verifyWritable } from './paths'

export type ProgressSink = (evt: InstallProgressEvent) => void
export type LogSink = (line: string) => void

function emitProgress(sink: ProgressSink, evt: InstallProgressEvent) {
  sink(evt)
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fse.createReadStream(path)
    stream.on('data', (d) => hash.update(d))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function downloadToFile(url: string, destPath: string, onProgress?: (t: { transferred: number; total?: number }) => void) {
  const res = await request(url, { method: 'GET' })
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Download failed: HTTP ${res.statusCode}`)

  const totalHeader = res.headers['content-length']
  const total = typeof totalHeader === 'string' ? Number(totalHeader) : undefined
  let transferred = 0

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath)
    res.body.on('data', (chunk: Buffer) => {
      transferred += chunk.length
      onProgress?.({ transferred, total })
    })
    res.body.on('error', reject)
    out.on('error', reject)
    out.on('finish', () => resolve())
    res.body.pipe(out)
  })
}

async function listTopLevelDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

async function resolveExtractionRoot(extractDir: string): Promise<string> {
  // Common patterns:
  // - zip contains package folders directly
  // - zip contains a single wrapper folder
  // - zip contains Community/<packages>
  // We allow descending up to 2 levels.

  let root = extractDir

  for (let depth = 0; depth < 2; depth++) {
    const topDirs = await listTopLevelDirs(root)

    // If exactly one directory, treat as wrapper and descend.
    if (topDirs.length === 1) {
      const maybeWrapper = join(root, topDirs[0]!)
      try {
        const s = await stat(maybeWrapper)
        if (s.isDirectory()) {
          root = maybeWrapper
          continue
        }
      } catch {
        // ignore
      }
    }

    // If Community exists, prefer it.
    if (topDirs.includes('Community')) {
      root = join(root, 'Community')
      continue
    }

    break
  }

  return root
}

async function detectPackageFolders(extractedRoot: string): Promise<string[]> {
  // Prefer folders that look like MSFS Community packages (manifest.json at folder root).
  const dirs = await listTopLevelDirs(extractedRoot)
  const candidates: string[] = []

  for (const d of dirs) {
    const manifestPath = join(extractedRoot, d, 'manifest.json')
    if (await fse.pathExists(manifestPath)) candidates.push(d)
  }

  return candidates.length ? candidates : dirs
}

async function atomicInstallFolders(opts: {
  extractedRoot: string
  communityPath: string
  folderNames: string[]
}): Promise<string[]> {
  const { extractedRoot, communityPath, folderNames } = opts

  await verifyWritable(communityPath)

  // Transactional install across all folders.
  // 1) Copy each source folder into a staged folder in Community
  // 2) Move any existing target folders to backups
  // 3) Move staged into final destinations
  // If anything fails, rollback from backups.

  const stages: Array<{ folderName: string; src: string; dst: string; stage: string; backup: string }> =
    folderNames.map((folderName) => {
      const src = join(extractedRoot, folderName)
      const dst = join(communityPath, folderName)
      const stage = join(communityPath, `.${folderName}.dsfc-stage`)
      const backup = join(communityPath, `.${folderName}.dsfc-backup`)
      return { folderName, src, dst, stage, backup }
    })

  const installedPaths: string[] = []
  const movedToBackup: Array<{ dst: string; backup: string; stage: string }> = []

  // cleanup any prior remnants
  for (const s of stages) {
    await fse.remove(s.stage)
    await fse.remove(s.backup)
  }

  try {
    // Stage copies first
    for (const s of stages) {
      if (!(await fse.pathExists(s.src))) {
        throw new Error(`Package folder not found in extracted content: ${s.folderName}`)
      }
      await fse.copy(s.src, s.stage)
    }

    // Swap
    for (const s of stages) {
      if (await fse.pathExists(s.dst)) {
        await fse.move(s.dst, s.backup, { overwrite: true })
      }
      movedToBackup.push({ dst: s.dst, backup: s.backup, stage: s.stage })
      await fse.move(s.stage, s.dst, { overwrite: true })
      installedPaths.push(s.dst)
    }

    // Cleanup backups after successful install
    for (const s of stages) {
      await fse.remove(s.backup)
    }

    return installedPaths
  } catch (err) {
    // Rollback: remove new installs and restore backups.
    for (const m of movedToBackup.reverse()) {
      try {
        await fse.remove(m.dst)
      } catch {
        // ignore
      }
      try {
        if (await fse.pathExists(m.backup)) {
          await fse.move(m.backup, m.dst, { overwrite: true })
        }
      } catch {
        // ignore
      }
      try {
        await fse.remove(m.stage)
      } catch {
        // ignore
      }
    }

    // Remove any stages/backups left
    for (const s of stages) {
      try { await fse.remove(s.stage) } catch {}
      try { await fse.remove(s.backup) } catch {}
    }

    throw err
  }
}

export class AddonInstallerService {
  constructor(private log: LogSink, private progress: ProgressSink) {}

  async installAddon(params: {
    addon: ManifestAddon
    channel: ManifestAddonChannel
    communityPath: string
  }): Promise<{ installedPaths: string[]; installedVersion: string }> {
    const { addon, channel, communityPath } = params

    const tempBase = join(getTempBaseDir(), 'dsfc-installer')
    await mkdir(tempBase, { recursive: true })

    const workDir = join(tempBase, `${addon.id}-${Date.now()}`)
    const zipPath = join(workDir, `${addon.id}.zip`)
    const extractDir = join(workDir, 'extracted')

    await mkdir(workDir, { recursive: true })

    this.log(`[${addon.id}] Downloading ${channel.zipUrl}`)
    emitProgress(this.progress, { addonId: addon.id, phase: 'downloading', percent: 0 })

    await downloadToFile(channel.zipUrl, zipPath, ({ transferred, total }) => {
      const percent = total ? Math.round((transferred / total) * 100) : undefined
      emitProgress(this.progress, {
        addonId: addon.id,
        phase: 'downloading',
        percent,
        transferredBytes: transferred,
        totalBytes: total,
      })
    })

    this.log(`[${addon.id}] Verifying SHA256`)
    emitProgress(this.progress, { addonId: addon.id, phase: 'verifying' })

    const actual = await sha256File(zipPath)
    if (actual.toLowerCase() !== channel.sha256.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${addon.id}: expected ${channel.sha256}, got ${actual}`)
    }

    this.log(`[${addon.id}] Extracting ZIP`)
    emitProgress(this.progress, { addonId: addon.id, phase: 'extracting' })

    await mkdir(extractDir, { recursive: true })
    await extractZip(zipPath, { dir: extractDir })

    const extractedRoot = await resolveExtractionRoot(extractDir)

    const folderNames = addon.packageFolderNames?.length
      ? addon.packageFolderNames
      : await detectPackageFolders(extractedRoot)

    if (!folderNames.length) throw new Error(`No package folders found for ${addon.id} after extraction`)

    this.log(`[${addon.id}] Installing to ${communityPath}`)
    this.log(`[${addon.id}] Package folders: ${folderNames.join(', ')}`)
    emitProgress(this.progress, { addonId: addon.id, phase: 'installing' })

    const installedPaths = await atomicInstallFolders({ extractedRoot, communityPath, folderNames })

    emitProgress(this.progress, { addonId: addon.id, phase: 'done', percent: 100 })
    this.log(`[${addon.id}] Done`)

    // Best-effort cleanup
    try {
      await rm(workDir, { recursive: true, force: true })
    } catch {
      // ignore
    }

    return { installedPaths, installedVersion: channel.version }
  }

  async uninstallAddon(params: { addonId: string; installedPaths: string[] }): Promise<void> {
    const { addonId, installedPaths } = params
    this.log(`[${addonId}] Uninstalling`)
    emitProgress(this.progress, { addonId, phase: 'uninstalling' })

    for (const p of installedPaths) {
      await fse.remove(p)
    }

    emitProgress(this.progress, { addonId, phase: 'done', percent: 100 })
    this.log(`[${addonId}] Uninstalled`)
  }
}
