import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import fse from 'fs-extra'
import extract from 'extract-zip'

function usageAndExit(msg) {
  if (msg) console.error(msg)
  console.error(
    [
      'Usage:',
      '  node scripts/update-manifest.js [manifestPath] [downloadsDir]',
      '',
      'Defaults:',
      '  manifestPath = ./manifest.json',
      '  downloadsDir = ./downloads',
      '',
      'ZIP resolution:',
      '  For each addon channel we try:',
      '   1) downloads/<addonId>/<channel>/<filename-from-zipUrl>',
      '   2) downloads/<addonId>/<filename-from-zipUrl>',
      '   3) downloads/<filename-from-zipUrl>',
      '',
      'You can also override with env:',
      '  MANIFEST_PATH=... DOWNLOADS_DIR=... node scripts/update-manifest.js',
    ].join('\n')
  )
  process.exit(1)
}

async function sha256File(filePath) {
  const buf = await fs.readFile(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

async function fileSizeBytes(filePath) {
  const st = await fs.stat(filePath)
  if (!st.isFile()) throw new Error(`Not a file: ${filePath}`)
  return st.size
}

async function sumDirBytes(dirPath) {
  let total = 0
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const e of entries) {
    const p = path.join(dirPath, e.name)
    if (e.isDirectory()) {
      total += await sumDirBytes(p)
    } else if (e.isFile()) {
      const st = await fs.stat(p)
      total += st.size
    }
    // ignore symlinks and others
  }
  return total
}

function pickZipFileName(channel) {
  const u = channel?.zipUrl || channel?.url
  if (typeof u !== 'string' || !u) return null
  try {
    const parsed = new URL(u)
    const base = path.posix.basename(parsed.pathname)
    return base || null
  } catch {
    // if it's not a valid URL, treat as path-like
    const base = path.basename(String(u))
    return base || null
  }
}

async function resolveZipPath({ downloadsDir, addonId, channelKey, fileName }) {
  const candidates = [
    path.join(downloadsDir, addonId, channelKey, fileName),
    path.join(downloadsDir, addonId, fileName),
    path.join(downloadsDir, fileName),
  ]

  for (const p of candidates) {
    if (await fse.pathExists(p)) return p
  }

  throw new Error(
    [
      `ZIP not found for addon=${addonId} channel=${channelKey}`,
      `Expected one of:`,
      ...candidates.map((c) => `  - ${c}`),
    ].join('\n')
  )
}

async function installedSizeFromZip(zipPath) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dfsc-manifest-'))
  const extractDir = path.join(tmpRoot, 'extract')
  try {
    await fse.ensureDir(extractDir)
    await extract(zipPath, { dir: extractDir })
    return await sumDirBytes(extractDir)
  } finally {
    try {
      await fse.remove(tmpRoot)
    } catch {
      // ignore cleanup failures
    }
  }
}

async function main() {
  const manifestPath =
    process.env.MANIFEST_PATH ||
    process.argv[2] ||
    path.resolve(process.cwd(), 'manifest.json')

  const downloadsDir =
    process.env.DOWNLOADS_DIR ||
    process.argv[3] ||
    path.resolve(process.cwd(), 'downloads')

  if (!(await fse.pathExists(manifestPath))) {
    usageAndExit(`Manifest file not found: ${manifestPath}`)
  }

  const raw = await fs.readFile(manifestPath, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse JSON: ${manifestPath}`)
  }

  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest must be an object')
  if (!Array.isArray(manifest.addons)) throw new Error('Manifest schema invalid: addons must be an array')

  const summary = []

  for (const addon of manifest.addons) {
    const addonId = addon?.id
    if (typeof addonId !== 'string' || !addonId) continue

    const channels = addon?.channels
    if (!channels || typeof channels !== 'object') continue

    for (const channelKey of ['stable', 'beta', 'dev']) {
      const ch = channels[channelKey]
      if (!ch) continue

      const fileName = pickZipFileName(ch)
      if (!fileName) {
        throw new Error(`Missing zipUrl/url for addon=${addonId} channel=${channelKey}`)
      }

      const zipPath = await resolveZipPath({ downloadsDir, addonId, channelKey, fileName })

      const sha256 = await sha256File(zipPath)
      const sizeBytes = await fileSizeBytes(zipPath)
      const installedSizeBytes = await installedSizeFromZip(zipPath)

      ch.sha256 = sha256
      ch.sizeBytes = sizeBytes
      ch.installedSizeBytes = installedSizeBytes

      summary.push({ addonId, channelKey, sha256, sizeBytes, installedSizeBytes, zipPath })
    }
  }

  // update generatedAt
  manifest.generatedAt = new Date().toISOString()

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  console.log(`[update-manifest] Updated: ${manifestPath}`)
  console.log(`[update-manifest] Downloads dir: ${downloadsDir}`)
  for (const s of summary) {
    console.log(
      [
        `- ${s.addonId} [${s.channelKey}]`,
        `  zip=${s.zipPath}`,
        `  sha256=${s.sha256}`,
        `  sizeBytes=${s.sizeBytes}`,
        `  installedSizeBytes=${s.installedSizeBytes}`,
      ].join('\n')
    )
  }
}

main().catch((err) => {
  console.error('[update-manifest] ERROR:', err?.message ?? String(err))
  process.exitCode = 1
})
