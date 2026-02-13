import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { join, basename, resolve } from 'path'
import { request } from 'undici'
import extractZip from 'extract-zip'
import fse from 'fs-extra'

import type { InstallProgressEvent, ManifestAddon, ManifestAddonChannel } from '@shared/types'
import { getTempBaseDir, verifyWritable } from './paths'

/**
 * ZIP layout support (common MSFS addon patterns):
 * - /<package>/manifest.json
 * - /<wrapper>/<package>/manifest.json
 * - /Community/<package>/manifest.json
 * - /<versioned-wrapper>/<package>/manifest.json
 */

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

async function listImmediateChildrenWithTypes(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.map((e) => `${e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other'}:${e.name}`)
}

async function listTopLevelEntries(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
}

async function buildCandidateRoots(extractDir: string): Promise<string[]> {
  const roots: string[] = []
  roots.push(extractDir)

  let wrapperRoot: string | null = null

  // If exactly one dir exists, treat as wrapper root.
  try {
    const topDirs = await listTopLevelDirs(extractDir)
    if (topDirs.length === 1) {
      wrapperRoot = join(extractDir, topDirs[0]!)
      roots.push(wrapperRoot)
    }
  } catch {
    // ignore
  }

  // If Community exists, treat that as a root.
  try {
    const topDirs = await listTopLevelDirs(extractDir)
    if (topDirs.includes('Community')) roots.push(join(extractDir, 'Community'))
  } catch {
    // ignore
  }

  // If wrapperRoot exists and contains Community, also try wrapperRoot/Community.
  if (wrapperRoot) {
    try {
      const topDirs = await listTopLevelDirs(wrapperRoot)
      if (topDirs.includes('Community')) roots.push(join(wrapperRoot, 'Community'))
    } catch {
      // ignore
    }
  }

  // De-dupe, preserve order.
  const seen = new Set<string>()
  return roots.filter((r) => {
    const k = r.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function isValidPackageFolder(folderPath: string): Promise<{ ok: boolean; hasManifest: boolean; hasLayout: boolean }> {
  const manifestPath = join(folderPath, 'manifest.json')
  const layoutPath = join(folderPath, 'layout.json')
  const hasManifest = await fse.pathExists(manifestPath)
  const hasLayout = await fse.pathExists(layoutPath)
  return { ok: hasManifest, hasManifest, hasLayout }
}

async function findManifestDirWithin(opts: { root: string; maxDepth: number; maxDirsVisited: number }): Promise<string | null> {
  let dirsVisited = 0
  const SKIP_NAMES = new Set(['node_modules', '__macosx', '.git', '.svn', '.hg'])

  async function walk(current: string, depth: number): Promise<string | null> {
    if (depth > opts.maxDepth) return null

    let entries: any[] = []
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return null
    }

    // If manifest.json is present in this directory, return it.
    for (const ent of entries) {
      if (ent.isFile && ent.isFile() && String(ent.name ?? '').toLowerCase() === 'manifest.json') {
        return current
      }
    }

    for (const ent of entries) {
      if (!ent.isDirectory || !ent.isDirectory()) continue
      const name = String(ent.name ?? '')
      const lower = name.toLowerCase()
      if (name.startsWith('.') || SKIP_NAMES.has(lower)) continue

      dirsVisited++
      if (dirsVisited > opts.maxDirsVisited) return null

      const res = await walk(join(current, name), depth + 1)
      if (res) return res
    }

    return null
  }

  return walk(opts.root, 0)
}

async function scanForPackages(opts: {
  root: string
  maxDepth: number
  maxDirsVisited: number
}): Promise<{
  packages: Array<{ folderName: string; folderPath: string; hasManifest: boolean; hasLayout: boolean }>
  dirsVisited: number
  capped: boolean
}> {
  const out: Array<{ folderName: string; folderPath: string; hasManifest: boolean; hasLayout: boolean }> = []
  let dirsVisited = 0
  let capped = false

  const SKIP_NAMES = new Set(['node_modules', '__macosx', '.git', '.svn', '.hg'])

  async function walk(current: string, depth: number) {
    if (capped) return
    if (depth > opts.maxDepth) return

    let entries: any[] = []
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const ent of entries) {
      if (capped) return
      if (!ent.isDirectory || !ent.isDirectory()) continue

      const name = String(ent.name ?? '')
      const lower = name.toLowerCase()
      if (name.startsWith('.') || SKIP_NAMES.has(lower)) continue

      dirsVisited++
      if (dirsVisited > opts.maxDirsVisited) {
        capped = true
        return
      }

      const p = join(current, name)

      const v = await isValidPackageFolder(p)
      if (v.ok) {
        out.push({ folderName: name, folderPath: p, hasManifest: v.hasManifest, hasLayout: v.hasLayout })
        continue
      }

      await walk(p, depth + 1)
    }
  }

  await walk(opts.root, 0)
  return { packages: out, dirsVisited, capped }
}

async function printTree(opts: {
  root: string
  log: LogSink
  maxDepth: number
  maxEntriesPerDir: number
}): Promise<void> {
  const { root, log, maxDepth, maxEntriesPerDir } = opts

  async function walk(current: string, depth: number, prefix: string) {
    if (depth > maxDepth) return

    let entries: any[] = []
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    const dirs = entries.filter((e) => e.isDirectory())
    const files = entries.filter((e) => e.isFile())

    const label = depth === 0 ? '/' : current.split(/[\\/]/).filter(Boolean).slice(-1)[0] + '/'
    log(`${prefix}${label} (dirs: ${dirs.length} files: ${files.length})`)

    const shown = entries.slice(0, maxEntriesPerDir)
    for (const ent of shown) {
      const name = String(ent.name ?? '')
      if (ent.isFile && ent.isFile()) {
        log(`${prefix}  ${name}`)
      }
    }
    if (entries.length > maxEntriesPerDir) {
      log(`${prefix}  … (${entries.length - maxEntriesPerDir} more entries)`)
    }

    for (const ent of dirs.slice(0, maxEntriesPerDir)) {
      const name = String(ent.name ?? '')
      await walk(join(current, name), depth + 1, prefix + '  ')
    }
  }

  log('[installer] extracted tree:')
  await walk(root, 0, '')
}

async function findExpectedPackages(opts: {
  extractDir: string
  packageFolderNames: string[]
  log: LogSink
}): Promise<{ detectedRoot: string; packages: Array<{ folderName: string; srcPath: string }> }> {
  const { extractDir, packageFolderNames, log } = opts

  const isWin = process.platform === 'win32'

  const candidateRoots = await buildCandidateRoots(extractDir)
  log(`[installer] extractDir=${extractDir}`)

  try {
    const top = await listImmediateChildrenWithTypes(extractDir)
    log('[installer] top-level entries:')
    for (const e of top) log(`  - ${e}`)
  } catch {
    log('[installer] top-level entries: (unavailable)')
  }

  log(`[installer] candidate roots:`)
  for (const r of candidateRoots) log(`  - ${r}`)

  // For each root, try resolving each expected folder.
  for (const root of candidateRoots) {
    log(`[installer] candidate root: ${root}`)
    try {
      const entries = await listImmediateChildrenWithTypes(root)
      log('[installer] entries:')
      for (const e of entries) log(`  - ${e}`)
    } catch {
      log('[installer] entries: (unavailable)')
    }

    const found: Array<{ folderName: string; srcPath: string }> = []

    // Also support "versioned wrapper" like /test-1.0.0/test by allowing one extra wrapper level.
    let wrapperDirs: string[] = []
    try {
      wrapperDirs = await listTopLevelDirs(root)
    } catch {
      wrapperDirs = []
    }

    const rootDirNames = wrapperDirs

    for (const expectedName of packageFolderNames) {
      log('[installer] checking for expected folder:')
      log(`  expected="${expectedName}"`)
      log('  comparing against:')
      for (const n of rootDirNames) log(`    "${n}"`)
      log(`  caseSensitive=${isWin ? 'false' : 'true'}`)

      const endsWithExpected = basename(root).toLowerCase() === expectedName.toLowerCase()
      const expectedPath = endsWithExpected ? root : join(root, expectedName)
      log(`  expectedPath=${expectedPath}`)

      const tryResolveAt = async (p: string): Promise<string | null> => {
        // First try direct folder-level manifest.
        const v = await isValidPackageFolder(p)
        if (v.ok) return p

        // If not present at that level, search within p for manifest.json up to depth 3.
        const manifestDir = await findManifestDirWithin({ root: p, maxDepth: 3, maxDirsVisited: 3_000 })
        if (manifestDir) {
          log(`[installer] manifest.json found at ${join(manifestDir, 'manifest.json')}, using packageRoot=${manifestDir}`)
          return manifestDir
        }

        return null
      }

      // Windows: case-insensitive directory name match at root level.
      let directPath = expectedPath
      if (!endsWithExpected && isWin) {
        const match = rootDirNames.find((n) => n.toLowerCase() === expectedName.toLowerCase())
        if (match) directPath = join(root, match)
      }

      // Targeted debug: existence probes for common nesting.
      const probePaths = [
        join(root, 'manifest.json'),
        join(root, 'layout.json'),
        join(root, expectedName, 'manifest.json'),
        join(root, expectedName, 'layout.json'),
      ]
      for (const pp of probePaths) {
        const ok = await fse.pathExists(pp)
        log(`  probe exists=${ok ? 'yes' : 'no'} path=${pp}`)
      }

      // If expectedPath exists, dump its immediate children too.
      try {
        const rootChildren = await listImmediateChildrenWithTypes(root)
        log('  candidateRoot children:')
        for (const e of rootChildren) log(`    - ${e}`)
      } catch {
        // ignore
      }

      if (await fse.pathExists(directPath)) {
        try {
          const expectedChildren = await listImmediateChildrenWithTypes(directPath)
          log('  expectedPath children:')
          for (const e of expectedChildren) log(`    - ${e}`)
        } catch {
          // ignore
        }
      }

      const resolvedDirect = await tryResolveAt(directPath)
      if (resolvedDirect) {
        log(`[installer] FOUND expected folder at ${resolvedDirect}`)
        found.push({ folderName: expectedName, srcPath: resolvedDirect })
        continue
      }

      log(`  tryingPath=${directPath}`)

      // Search one level down: <root>/<wrapper>/<expected>
      let matched: string | null = null
      for (const w of wrapperDirs) {
        // Compare within wrapper (case-insensitive on Windows)
        let subDirs: string[] = []
        try {
          subDirs = await listTopLevelDirs(join(root, w))
        } catch {
          subDirs = []
        }

        let candidate = join(root, w, expectedName)
        if (isWin) {
          const match = subDirs.find((n) => n.toLowerCase() === expectedName.toLowerCase())
          if (match) candidate = join(root, w, match)
        }

        log(`  tryingPath=${candidate}`)
        const resolved = await tryResolveAt(candidate)
        if (resolved) {
          matched = resolved
          break
        }
      }

      if (matched) {
        log(`[installer] FOUND expected folder at ${matched}`)
        found.push({ folderName: expectedName, srcPath: matched })
      }
    }

    if (found.length === packageFolderNames.length) {
      log(`[installer] detected package root: ${root}`)
      return { detectedRoot: root, packages: found }
    }
  }

  // Fallback: auto-detect MSFS packages (bounded recursive scan).
  const top = await listTopLevelEntries(extractDir).catch(() => [])
  log(`[installer] expected folder(s) missing; attempting auto-detection (maxDepth=6)`)
  log(`[installer] extractedRoot entries: ${top.join(', ') || '(unavailable)'}`)

  const detectedAll: Array<{ folderName: string; folderPath: string; hasManifest: boolean; hasLayout: boolean }> = []
  for (const root of candidateRoots) {
    const res = await scanForPackages({ root, maxDepth: 6, maxDirsVisited: 3_000 })
    const hits = res.packages
    log(`[installer] auto-detect root=${root} hits=${hits.length} dirsVisited=${res.dirsVisited}${res.capped ? ' (capped)' : ''}`)
    for (const h of hits) {
      log(`  - ${h.folderName} @ ${h.folderPath} (manifest=${h.hasManifest ? 'yes' : 'no'} layout=${h.hasLayout ? 'yes' : 'no'})`)
    }
    detectedAll.push(...hits)
  }

  // De-dupe by full path.
  const seen = new Set<string>()
  const detected = detectedAll.filter((h) => {
    const k = h.folderPath.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  if (detected.length === 1) {
    const only = detected[0]!
    log(`[installer] expected folder(s) missing, auto-detected package: ${only.folderName}`)
    return { detectedRoot: extractDir, packages: [{ folderName: only.folderName, srcPath: only.folderPath }] }
  }

  // High-signal tree preview for debugging.
  await printTree({ root: extractDir, log, maxDepth: 3, maxEntriesPerDir: 50 })

  const detectedNames = detected.map((d) => d.folderName)
  const expected = packageFolderNames.join(', ')
  const detectedList = detected.map((d) => `${d.folderName} (${d.folderPath})`).join(', ')

  throw new Error(
    `Expected folder(s) not found: [${expected}]. Candidate roots: [${candidateRoots.join(', ')}]. ` +
      `Detected packages: [${detectedNames.join(', ') || 'none'}]. ` +
      `Set manifest.packageFolderNames to one of: ${detectedList || '(none found)'} or fix the ZIP structure.`
  )
}

function assertUnder(baseDir: string, p: string) {
  const base = resolve(baseDir)
  const full = resolve(p)
  if (!full.toLowerCase().startsWith(base.toLowerCase())) {
    throw new Error(`Unsafe path traversal detected: ${full}`)
  }
}

async function findRawFolders(opts: {
  extractDir: string
  expectedFolderNames: string[]
  log: LogSink
}): Promise<Array<{ folderName: string; srcPath: string }>> {
  const { extractDir, expectedFolderNames, log } = opts
  const isWin = process.platform === 'win32'

  const candidateRoots = await buildCandidateRoots(extractDir)
  log(`[installer] raw install: candidate roots:`)
  for (const r of candidateRoots) log(`  - ${r}`)

  const packages: Array<{ folderName: string; srcPath: string }> = []

  for (const expectedName of expectedFolderNames) {
    let foundPath: string | null = null

    for (const root of candidateRoots) {
      const endsWithExpected = basename(root).toLowerCase() === expectedName.toLowerCase()
      const expectedPath = endsWithExpected ? root : join(root, expectedName)

      // Case-insensitive exact folder match at root level (Windows).
      let directPath = expectedPath
      if (!endsWithExpected && isWin) {
        const dirs = await listTopLevelDirs(root).catch(() => [])
        const match = dirs.find((n) => n.toLowerCase() === expectedName.toLowerCase())
        if (match) directPath = join(root, match)
      }

      if (await fse.pathExists(directPath)) {
        try {
          const s = await stat(directPath)
          if (s.isDirectory()) {
            foundPath = directPath
            break
          }
        } catch {
          // ignore
        }
      }

      // One wrapper level: <root>/<wrapper>/<expected>
      const wrapperDirs = await listTopLevelDirs(root).catch(() => [])
      for (const w of wrapperDirs) {
        const baseW = join(root, w)
        const subDirs = await listTopLevelDirs(baseW).catch(() => [])
        let candidate = join(baseW, expectedName)
        if (isWin) {
          const match = subDirs.find((n) => n.toLowerCase() === expectedName.toLowerCase())
          if (match) candidate = join(baseW, match)
        }
        if (await fse.pathExists(candidate)) {
          try {
            const s = await stat(candidate)
            if (s.isDirectory()) {
              foundPath = candidate
              break
            }
          } catch {
            // ignore
          }
        }
      }

      if (foundPath) break
    }

    if (!foundPath) {
      await printTree({ root: extractDir, log, maxDepth: 3, maxEntriesPerDir: 50 })
      throw new Error(
        `Raw install: expected folder '${expectedName}' not found anywhere in extracted ZIP. ` +
          `Set packageFolderNames to match the ZIP folder(s), or fix the ZIP structure.`
      )
    }

    assertUnder(extractDir, foundPath)
    packages.push({ folderName: expectedName, srcPath: foundPath })
  }

  return packages
}

async function autoDetectPackages(opts: { extractDir: string; log: LogSink }): Promise<{ root: string; folderNames: string[] }> {
  const { extractDir, log } = opts
  const candidateRoots = await buildCandidateRoots(extractDir)

  for (const root of candidateRoots) {
    const dirs = await listTopLevelDirs(root).catch(() => [])
    const hits: string[] = []
    for (const d of dirs) {
      if (await isValidPackageFolder(join(root, d))) hits.push(d)
    }
    if (hits.length) {
      log(`[installer] detected package root: ${root}`)
      log(`[installer] auto-detected packages: ${hits.join(', ')}`)
      return { root, folderNames: hits }
    }
  }

  return { root: extractDir, folderNames: [] }
}

async function atomicInstallFolders(opts: {
  packages: Array<{ folderName: string; srcPath: string }>
  communityPath: string
}): Promise<string[]> {
  const { packages, communityPath } = opts

  await verifyWritable(communityPath)

  // Transactional install across all folders.
  // 1) Copy each source folder into a staged folder in Community
  // 2) Move any existing target folders to backups
  // 3) Move staged into final destinations
  // If anything fails, rollback from backups.

  const stages: Array<{ folderName: string; src: string; dst: string; stage: string; backup: string }> =
    packages.map(({ folderName, srcPath }) => {
      const src = srcPath
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
    channelKey: string
    installPath: string
  }): Promise<{ installedPaths: string[]; installedVersion: string }> {
    const { addon, channel, installPath, channelKey } = params

    const tempBase = join(getTempBaseDir(), 'dfsc-installer')
    await mkdir(tempBase, { recursive: true })

    const workDir = join(tempBase, `${addon.id}-${Date.now()}`)
    const zipPath = join(workDir, `${addon.id}.zip`)
    const extractDir = join(workDir, 'extracted')

    await mkdir(workDir, { recursive: true })

    const downloadUrl = channel.zipUrl ?? channel.url
    if (process.env.NODE_ENV === 'development') {
      this.log(`[${addon.id}] [install] resolved downloadUrl=${downloadUrl ?? ''}`)
    }

    if (typeof downloadUrl !== 'string' || !downloadUrl.trim() || !/^https?:\/\//i.test(downloadUrl.trim())) {
      throw new Error(
        `Invalid download URL for addon ${addon.id} channel ${channelKey}. Expected channel.zipUrl (preferred) or channel.url.`
      )
    }

    this.log(`[installer] installing addonId=${addon.id} channel=${channelKey} expectedFolders=${(addon.packageFolderNames ?? []).join(',')}`)
    this.log(`[${addon.id}] Downloading ${downloadUrl}`)
    emitProgress(this.progress, { addonId: addon.id, phase: 'downloading', percent: 0 })

    await downloadToFile(downloadUrl, zipPath, ({ transferred, total }) => {
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

    this.log(`[${addon.id}] [installer] extractDir=${extractDir}`)
    try {
      const top = await listImmediateChildrenWithTypes(extractDir)
      this.log(`[${addon.id}] [installer] top-level entries:`)
      for (const e of top) this.log(`[${addon.id}] [installer]   - ${e}`)
    } catch {
      this.log(`[${addon.id}] [installer] top-level entries: (unavailable)`)
    }

    // Determine install units.
    let packages: Array<{ folderName: string; srcPath: string }> = []

    if (addon.allowRawInstall) {
      this.log(`[${addon.id}] [installer] raw install mode enabled`)

      if (addon.packageFolderNames?.length) {
        packages = await findRawFolders({
          extractDir,
          expectedFolderNames: addon.packageFolderNames,
          log: (l) => this.log(`[${addon.id}] ${l}`),
        })
      } else {
        // No explicit folders: install the extracted content as-is.
        const entries = await readdir(extractDir, { withFileTypes: true }).catch(() => [])
        const dirs = entries.filter((e) => e.isDirectory())
        const files = entries.filter((e) => e.isFile())

        if (dirs.length === 1 && files.length === 0) {
          const name = dirs[0]!.name
          const srcPath = join(extractDir, name)
          packages = [{ folderName: name, srcPath }]
        } else {
          // Bundle everything into <installPath>/<addonId>/
          const rawRoot = join(workDir, 'rawroot')
          await mkdir(rawRoot, { recursive: true })

          for (const ent of entries) {
            const name = String(ent.name ?? '')
            // basic sanitization
            if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue
            await fse.copy(join(extractDir, name), join(rawRoot, name))
          }

          packages = [{ folderName: addon.id, srcPath: rawRoot }]
        }
      }
    } else {
      // Strict MSFS package install mode (default)
      if (addon.packageFolderNames?.length) {
        const res = await findExpectedPackages({
          extractDir,
          packageFolderNames: addon.packageFolderNames,
          log: (l) => this.log(`[${addon.id}] ${l}`),
        })
        packages = res.packages
      } else {
        const res = await autoDetectPackages({ extractDir, log: (l) => this.log(`[${addon.id}] ${l}`) })
        if (!res.folderNames.length) {
          throw new Error(`No package folders found for ${addon.id} after extraction`)
        }
        packages = res.folderNames.map((folderName) => ({ folderName, srcPath: join(res.root, folderName) }))
      }
    }

    this.log(`[${addon.id}] Installing to ${installPath}`)
    this.log(`[${addon.id}] Package folders: ${packages.map((p) => p.folderName).join(', ')}`)
    emitProgress(this.progress, { addonId: addon.id, phase: 'installing' })

    const installedPaths = await atomicInstallFolders({ packages, communityPath: installPath })

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
