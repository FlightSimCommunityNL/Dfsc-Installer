import { createHash } from 'crypto'
import { createWriteStream, createReadStream } from 'fs'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import { join, basename, resolve, dirname, relative } from 'path'
import { request } from 'undici'
import fse from 'fs-extra'
import yauzl from 'yauzl'
import { pipeline } from 'stream/promises'

import type { InstallProgressEvent, ManifestAddon, ManifestAddonChannel } from '@shared/types'
import { getTempBaseDir, verifyWritable } from './paths'
import { getDiskSpaceForPath } from './diskspace'

/**
 * ZIP layout support (common MSFS addon patterns):
 * - /<package>/manifest.json
 * - /<wrapper>/<package>/manifest.json
 * - /Community/<package>/manifest.json
 * - /<versioned-wrapper>/<package>/manifest.json
 */

export type ProgressSink = (evt: InstallProgressEvent) => void
export type LogSink = (line: string) => void

function clampPct(p: number): number {
  const n = Number(p)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function mapOverall(phase: InstallProgressEvent['phase'], phasePercent?: number): number | undefined {
  const p = typeof phasePercent === 'number' ? clampPct(phasePercent) : undefined
  if (p == null) {
    // If we don't have a phase percent, still provide a stable overall for some phases.
    if (phase === 'verifying') return 60
    if (phase === 'done') return 100
    return undefined
  }

  if (phase === 'downloading') return clampPct(p * 0.6)
  if (phase === 'extracting') return clampPct(60 + p * 0.25)
  if (phase === 'installing') return clampPct(85 + p * 0.15)
  if (phase === 'verifying') return 60
  if (phase === 'done') return 100
  return undefined
}

const progressThrottleState = new Map<string, { t: number; lastPct?: number }>()

function emitProgress(sink: ProgressSink, evt: InstallProgressEvent) {
  const overall = evt.overallPercent ?? mapOverall(evt.phase, evt.percent)
  sink({ ...evt, overallPercent: overall })
}

function emitProgressThrottled(
  sink: ProgressSink,
  evt: InstallProgressEvent,
  opts?: { minIntervalMs?: number; force?: boolean }
) {
  const minIntervalMs = opts?.minIntervalMs ?? 100
  const force = opts?.force === true

  const pct = typeof evt.percent === 'number' ? clampPct(evt.percent) : undefined
  const key = `${evt.addonId}:${evt.phase}`
  const now = Date.now()
  const prev = progressThrottleState.get(key)

  const isTerminal = evt.phase === 'done' || pct === 100

  if (!force && !isTerminal && prev) {
    const tooSoon = now - prev.t < minIntervalMs
    const samePct = pct != null && prev.lastPct != null ? Math.abs(pct - prev.lastPct) < 0.01 : false
    if (tooSoon && samePct) return
    if (tooSoon) return
  }

  progressThrottleState.set(key, { t: now, lastPct: pct })
  emitProgress(sink, evt)
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

async function sumDirBytes(dirPath: string): Promise<number> {
  let total = 0
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
  for (const ent of entries) {
    const p = join(dirPath, ent.name)
    if (ent.isDirectory()) {
      total += await sumDirBytes(p)
    } else if (ent.isFile()) {
      try {
        const s = await stat(p)
        total += s.size
      } catch {
        // ignore
      }
    }
  }
  return total
}

function assertUnderDir(baseDir: string, candidate: string) {
  const base = resolve(baseDir)
  const full = resolve(candidate)
  if (!full.toLowerCase().startsWith(base.toLowerCase())) {
    throw new Error(`Unsafe path traversal detected: ${full}`)
  }
}

async function getZipTotals(zipPath: string): Promise<{ totalBytes: number; totalFiles: number }> {
  const open = () =>
    new Promise<any>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) reject(err)
        else resolve(zipfile)
      })
    })

  const zipfile = await open()
  let totalBytes = 0
  let totalFiles = 0

  await new Promise<void>((resolveP, rejectP) => {
    zipfile.readEntry()
    zipfile.on('entry', (entry: any) => {
      const name = String(entry.fileName ?? '')
      const isDir = name.endsWith('/')
      if (!isDir) {
        totalFiles += 1
        totalBytes += Number(entry.uncompressedSize ?? 0)
      }
      zipfile.readEntry()
    })
    zipfile.on('end', () => resolveP())
    zipfile.on('error', rejectP)
  })

  try {
    zipfile.close()
  } catch {
    // ignore
  }

  return { totalBytes, totalFiles }
}

async function extractZipWithProgress(opts: {
  addonId: string
  zipPath: string
  extractDir: string
  progress: ProgressSink
}): Promise<void> {
  const { addonId, zipPath, extractDir, progress } = opts

  emitProgress(progress, { addonId, phase: 'extracting', percent: 0, message: 'Preparing extraction…' })

  const totals = await getZipTotals(zipPath)
  const totalBytes = totals.totalBytes
  const totalFiles = totals.totalFiles

  let extractedBytes = 0
  let extractedFiles = 0

  const open = () =>
    new Promise<any>((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) reject(err)
        else resolve(zipfile)
      })
    })

  const zipfile = await open()

  const hasTotals = totalBytes > 0 || totalFiles > 0

  const computePct = () => {
    if (totalBytes > 0) return (extractedBytes / totalBytes) * 100
    if (totalFiles > 0) return (extractedFiles / totalFiles) * 100
    return undefined
  }

  const emit = (force?: boolean) => {
    const pct = computePct()
    const msg = totalFiles > 0 ? `Extracting (${extractedFiles}/${totalFiles})` : 'Extracting…'
    emitProgressThrottled(
      progress,
      { addonId, phase: 'extracting', percent: pct == null ? undefined : clampPct(pct), message: msg },
      { force, minIntervalMs: 100 }
    )
  }

  // If we can't compute totals, tick periodically so UI never looks frozen.
  const tick = !hasTotals
    ? setInterval(() => {
        emit(false)
      }, 250)
    : null

  // start at 0
  emitProgress(progress, { addonId, phase: 'extracting', percent: 0, message: totalFiles > 0 ? `Extracting (0/${totalFiles})` : 'Extracting…' })

  try {
    await new Promise<void>((resolveP, rejectP) => {
    const onEntry = (entry: any) => {
      const rel = String(entry.fileName ?? '')
      if (!rel) {
        zipfile.readEntry()
        return
      }

      const destPath = join(extractDir, rel)
      assertUnderDir(extractDir, destPath)

      if (rel.endsWith('/')) {
        void fse
          .ensureDir(destPath)
          .then(() => zipfile.readEntry())
          .catch(rejectP)
        return
      }

      void fse
        .ensureDir(dirname(destPath))
        .then(
          () =>
            new Promise<void>((res, rej) => {
              zipfile.openReadStream(entry, (err: any, rs: any) => {
                if (err || !rs) return rej(err)

                rs.on('data', (chunk: Buffer) => {
                  extractedBytes += chunk.length
                  emit(false)
                })

                const ws = createWriteStream(destPath)
                pipeline(rs, ws)
                  .then(() => {
                    extractedFiles += 1
                    // Always emit on file completion so short files still show progress.
                    emit(true)
                    res()
                  })
                  .catch(rej)
              })
            })
        )
        .then(() => {
          zipfile.readEntry()
        })
        .catch(rejectP)
    }

    zipfile.on('entry', onEntry)
    zipfile.on('end', () => resolveP())
    zipfile.on('error', rejectP)

    zipfile.readEntry()
    })
  } finally {
    if (tick) clearInterval(tick)
  }

  try {
    zipfile.close()
  } catch {
    // ignore
  }

  emitProgress(progress, { addonId, phase: 'extracting', percent: 100, message: totalFiles > 0 ? `Extracting (${totalFiles}/${totalFiles})` : 'Extracting…' })
}

async function listFilesRecursive(root: string): Promise<Array<{ path: string; size: number; mode?: number }>> {
  const out: Array<{ path: string; size: number; mode?: number }> = []

  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const ent of entries) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) {
        await walk(p)
      } else if (ent.isFile()) {
        try {
          const s = await stat(p)
          out.push({ path: p, size: s.size, mode: (s as any).mode })
        } catch {
          // ignore
        }
      }
    }
  }

  await walk(root)
  return out
}

async function copyDirWithProgress(opts: {
  addonId: string
  srcDir: string
  dstDir: string
  progress: ProgressSink
  totalBytes: number
  totalFiles: number
  counters: { copiedBytes: number; copiedFiles: number }
}): Promise<void> {
  const { addonId, srcDir, dstDir, progress, totalBytes, totalFiles, counters } = opts

  await fse.ensureDir(dstDir)
  const files = await listFilesRecursive(srcDir)

  const hasTotals = totalBytes > 0 || totalFiles > 0

  const computePct = () => {
    if (totalBytes > 0) return (counters.copiedBytes / totalBytes) * 100
    if (totalFiles > 0) return (counters.copiedFiles / totalFiles) * 100
    return undefined
  }

  const emit = (force?: boolean) => {
    const pct = computePct()
    const msg = totalFiles > 0 ? `Installing (${counters.copiedFiles}/${totalFiles})` : 'Installing…'
    emitProgressThrottled(
      progress,
      { addonId, phase: 'installing', percent: pct == null ? undefined : clampPct(pct), message: msg },
      { force, minIntervalMs: 100 }
    )
  }

  const tick = !hasTotals
    ? setInterval(() => {
        emit(false)
      }, 250)
    : null

  try {
    for (const f of files) {
    const rel = relative(srcDir, f.path)
    const dst = join(dstDir, rel)
    assertUnderDir(dstDir, dst)
    await fse.ensureDir(dirname(dst))

    await new Promise<void>((resolveP, rejectP) => {
      const rs = createReadStream(f.path)
      rs.on('data', (chunk: Buffer) => {
        counters.copiedBytes += chunk.length
        emit(false)
      })
      rs.on('error', rejectP)
      const ws = createWriteStream(dst)
      ws.on('error', rejectP)
      ws.on('finish', () => resolveP())
      rs.pipe(ws)
    })

    counters.copiedFiles += 1
    emit(true)

    // Preserve permissions best-effort
    if (typeof f.mode === 'number') {
      try {
        await fse.chmod(dst, f.mode)
      } catch {
        // ignore
      }
    }

    // Yield occasionally so IPC + UI stay snappy even with huge file lists.
    if (counters.copiedFiles % 50 === 0) {
      await new Promise<void>((r) => setImmediate(r))
    }
    }
  } finally {
    if (tick) clearInterval(tick)
  }
}

function requiredBytesFromInstalledSize(installedBytes: number): number {
  const buffer = 200 * 1024 * 1024
  return Math.ceil(installedBytes * 1.2 + buffer)
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

async function resolveRawInstallSources(opts: {
  addonId: string
  extractDir: string
  expectedFolderNames?: string[]
  workDir: string
  log: LogSink
}): Promise<Array<{ folderName: string; srcPath: string }>> {
  const { addonId, extractDir, expectedFolderNames, workDir, log } = opts
  const isWin = process.platform === 'win32'

  if (expectedFolderNames?.length) {
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
          `RAW MODE: could not locate folder '${expectedName}'. ` +
            `Set packageFolderNames to match the ZIP folder(s), or fix the ZIP structure.`
        )
      }

      assertUnder(extractDir, foundPath)
      packages.push({ folderName: expectedName, srcPath: foundPath })
    }

    return packages
  }

  // No explicit folders: install the extracted content as-is.
  const entries = await readdir(extractDir, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((e) => e.isDirectory())
  const files = entries.filter((e) => e.isFile())

  if (dirs.length === 1 && files.length === 0) {
    const name = dirs[0]!.name
    return [{ folderName: name, srcPath: join(extractDir, name) }]
  }

  // Bundle everything into <installPath>/<addonId>/
  const rawRoot = join(workDir, 'rawroot')
  await mkdir(rawRoot, { recursive: true })

  for (const ent of entries) {
    const name = String(ent.name ?? '')
    // basic sanitization
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue
    await fse.copy(join(extractDir, name), join(rawRoot, name))
  }

  return [{ folderName: addonId, srcPath: rawRoot }]
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

  // Backwards-compat wrapper used by earlier implementation.
  return resolveRawInstallSources({
    addonId: 'addon',
    extractDir: opts.extractDir,
    expectedFolderNames: opts.expectedFolderNames,
    workDir: opts.extractDir,
    log: opts.log,
  })
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
  addonId: string
  packages: Array<{ folderName: string; srcPath: string }>
  communityPath: string
  progress: ProgressSink
}): Promise<string[]> {
  const { addonId, packages, communityPath, progress } = opts

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
    // Stage copies first (with progress)
    emitProgress(progress, { addonId, phase: 'installing', percent: 0, message: 'Preparing install…' })

    let totalBytes = 0
    let totalFiles = 0

    // Pre-scan for deterministic totals.
    for (const s of stages) {
      if (!(await fse.pathExists(s.src))) {
        throw new Error(`Package folder not found in extracted content: ${s.folderName}`)
      }
      const files = await listFilesRecursive(s.src)
      totalFiles += files.length
      totalBytes += files.reduce((a, f) => a + (f.size ?? 0), 0)
    }

    const counters = { copiedBytes: 0, copiedFiles: 0 }

    emitProgress(progress, {
      addonId,
      phase: 'installing',
      percent: 0,
      message: totalFiles > 0 ? `Installing (0/${totalFiles})` : 'Installing…',
    })

    for (const s of stages) {
      await copyDirWithProgress({
        addonId,
        srcDir: s.src,
        dstDir: s.stage,
        progress,
        totalBytes,
        totalFiles,
        counters,
      })
    }

    // Ensure we end the copy at 100 within the phase.
    emitProgress(progress, {
      addonId,
      phase: 'installing',
      percent: 100,
      message: totalFiles > 0 ? `Installing (${totalFiles}/${totalFiles})` : 'Installing…',
    })

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

    try {
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
    await mkdir(extractDir, { recursive: true })
    await extractZipWithProgress({ addonId: addon.id, zipPath, extractDir, progress: this.progress })

    this.log(`[${addon.id}] [installer] extractDir=${extractDir}`)
    try {
      const top = await listImmediateChildrenWithTypes(extractDir)
      this.log(`[${addon.id}] [installer] top-level entries:`)
      for (const e of top) this.log(`[${addon.id}] [installer]   - ${e}`)
    } catch {
      this.log(`[${addon.id}] [installer] top-level entries: (unavailable)`)
    }

    // Deterministic mode selection MUST happen before any strict package detection.
    this.log(
      `[installer] addonId=${addon.id} allowRawInstall=${addon.allowRawInstall === true ? 'true' : 'false'} expectedFolders=${(
        addon.packageFolderNames ?? []
      ).join(',')}`
    )

    if (addon.allowRawInstall === true) {
      this.log(`[installer] allowRawInstall=true -> using RAW install mode`)

      const packages = await resolveRawInstallSources({
        addonId: addon.id,
        extractDir,
        expectedFolderNames: addon.packageFolderNames,
        workDir,
        log: (l) => this.log(`[${addon.id}] ${l}`),
      })

      this.log(`[${addon.id}] Installing to ${installPath}`)
      this.log(`[${addon.id}] Raw install folders: ${packages.map((p) => p.folderName).join(', ')}`)

      // Final preflight: compute extracted size and verify disk space before atomic move.
      const extractedBytes = await Promise.all(packages.map((p) => sumDirBytes(p.srcPath))).then((xs) => xs.reduce((a, b) => a + b, 0))
      const required = requiredBytesFromInstalledSize(extractedBytes)
      const disk = await getDiskSpaceForPath(installPath)
      if (disk.freeBytes < required) {
        throw new Error(
          `Not enough disk space for ${addon.id}. Required=${required} bytes, free=${disk.freeBytes} bytes.`
        )
      }

      emitProgress(this.progress, { addonId: addon.id, phase: 'installing' })
      const installedPaths = await atomicInstallFolders({ addonId: addon.id, packages, communityPath: installPath, progress: this.progress })

      emitProgress(this.progress, { addonId: addon.id, phase: 'done', percent: 100, message: 'Installed' })
      this.log(`[${addon.id}] Done`)

      // Best-effort cleanup
      try {
        await rm(workDir, { recursive: true, force: true })
      } catch {
        // ignore
      }

      return { installedPaths, installedVersion: channel.version }
    }

    // STRICT MSFS package install mode (default)
    let packages: Array<{ folderName: string; srcPath: string }> = []

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

    this.log(`[${addon.id}] Installing to ${installPath}`)
    this.log(`[${addon.id}] Package folders: ${packages.map((p) => p.folderName).join(', ')}`)

    // Final preflight: compute extracted size and verify disk space before atomic move.
    const extractedBytes = await Promise.all(packages.map((p) => sumDirBytes(p.srcPath))).then((xs) => xs.reduce((a, b) => a + b, 0))
    const required = requiredBytesFromInstalledSize(extractedBytes)
    const disk = await getDiskSpaceForPath(installPath)
    if (disk.freeBytes < required) {
      throw new Error(
        `Not enough disk space for ${addon.id}. Required=${required} bytes, free=${disk.freeBytes} bytes.`
      )
    }

    emitProgress(this.progress, { addonId: addon.id, phase: 'installing' })
    const installedPaths = await atomicInstallFolders({ addonId: addon.id, packages, communityPath: installPath, progress: this.progress })

    emitProgress(this.progress, { addonId: addon.id, phase: 'done', percent: 100, message: 'Installed' })
    this.log(`[${addon.id}] Done`)

    // Best-effort cleanup
    try {
      await rm(workDir, { recursive: true, force: true })
    } catch {
      // ignore
    }

    return { installedPaths, installedVersion: channel.version }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      // Ensure UI never looks frozen on failure.
      emitProgress(this.progress, {
        addonId: addon.id,
        phase: 'installing',
        overallPercent: 85,
        message: `Install failed: ${msg}`,
      })
      throw err
    }
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
