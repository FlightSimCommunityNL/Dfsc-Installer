import { dialog, app } from 'electron'
import { access, readFile, stat, readdir } from 'fs/promises'
import { constants } from 'fs'
import { join } from 'path'
import os from 'os'

export async function browseForCommunityPath(win: Electron.BrowserWindow): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select MSFS Community folder',
    properties: ['openDirectory'],
  })
  if (res.canceled) return null
  return res.filePaths[0] ?? null
}

export async function verifyWritable(dir: string): Promise<void> {
  await access(dir, constants.W_OK)
}

/**
 * Best-effort detector.
 * NOTE: MSFS 2024 exact locations can vary; this is intentionally heuristic.
 * Always allow manual override in UI.
 */
export async function detectCommunityPathWindows(opts?: {
  msStorePackageFamilyName?: string
  extraCandidates?: string[]
}): Promise<string | null> {
  if (process.platform !== 'win32') return null

  const msStorePackageFamilyName = opts?.msStorePackageFamilyName || 'Microsoft.FlightSimulator_8wekyb3d8bbwe'

  const candidates: string[] = []

  const appData = process.env.APPDATA
  const localAppData = process.env.LOCALAPPDATA

  // 1) MSFS 2024 + 2020: parse UserCfg.opt for InstalledPackagesPath (most reliable)
  // Known MSFS 2024 locations first.
  const userCfgCandidates: string[] = [
    // MS Store / Game Pass (MSFS 2024)
    localAppData ? join(localAppData, 'Packages', 'Microsoft.Limitless_8wekyb3d8bbwe', 'LocalCache', 'UserCfg.opt') : '',
    // Steam (MSFS 2024)
    appData ? join(appData, 'Microsoft Flight Simulator 2024', 'UserCfg.opt') : '',

    // Existing MSFS 2020 candidates
    appData ? join(appData, 'Microsoft Flight Simulator', 'UserCfg.opt') : '',
    localAppData ? join(localAppData, 'Packages', msStorePackageFamilyName, 'LocalCache', 'UserCfg.opt') : '',
  ].filter(Boolean)

  for (const cfgPath of userCfgCandidates) {
    console.log(`[autodetect] checking ${cfgPath}`)
    const installedPackagesPath = await readInstalledPackagesPath(cfgPath)
    if (installedPackagesPath) {
      console.log(`[autodetect] found usercfg at ${cfgPath}`)
      console.log(`[autodetect] InstalledPackagesPath=${installedPackagesPath}`)
      const community = join(installedPackagesPath, 'Community')
      console.log(`[autodetect] Community=${community}`)
      candidates.push(community)
    }
  }

  // 2) Known fallbacks (keep older heuristic paths too)
  if (appData) {
    candidates.push(join(appData, 'Microsoft Flight Simulator', 'Packages', 'Community'))
    candidates.push(join(appData, 'Microsoft Flight Simulator 2024', 'Packages', 'Community'))
  }

  if (localAppData) {
    candidates.push(join(localAppData, 'Packages', msStorePackageFamilyName, 'LocalCache', 'Packages', 'Community'))
    candidates.push(join(localAppData, 'Packages', 'Microsoft.Limitless_8wekyb3d8bbwe', 'LocalCache', 'Packages', 'Community'))
  }

  // 3) User-provided extra candidates
  if (opts?.extraCandidates?.length) candidates.push(...opts.extraCandidates)

  // 4) Optional limited search for UserCfg.opt (cap runtime ~2s)
  const searchedCfgs = await findUserCfgOptLimited({ localAppData, appData, timeoutMs: 2_000 })
  for (const cfgPath of searchedCfgs) {
    if (userCfgCandidates.includes(cfgPath)) continue
    console.log(`[autodetect] checking ${cfgPath}`)
    const installedPackagesPath = await readInstalledPackagesPath(cfgPath)
    if (installedPackagesPath) {
      console.log(`[autodetect] found usercfg at ${cfgPath}`)
      console.log(`[autodetect] InstalledPackagesPath=${installedPackagesPath}`)
      const community = join(installedPackagesPath, 'Community')
      console.log(`[autodetect] Community=${community}`)
      candidates.push(community)
    }
  }

  // De-dupe, preserve order
  const seen = new Set<string>()
  const unique = candidates.filter((p) => {
    const key = p.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  for (const p of unique) {
    const ok = await validateCommunityCandidate(p)
    console.log(`[autodetect] Community=${p} (exists/writable ${ok ? 'yes' : 'no'})`)
    if (ok) return p
  }

  return null
}

async function readInstalledPackagesPath(userCfgOptPath: string): Promise<string | null> {
  try {
    const txt = await readFile(userCfgOptPath, 'utf8')
    // Example line in MSFS configs:
    // InstalledPackagesPath "D:\\MSFS\\Packages"
    const m = txt.match(/InstalledPackagesPath\s+"([^"]+)"/i)
    return m?.[1] ?? null
  } catch {
    return null
  }
}

async function validateCommunityCandidate(p: string): Promise<boolean> {
  try {
    const st = await stat(p)
    if (!st.isDirectory()) return false
    await verifyWritable(p)
    return true
  } catch {
    return false
  }
}

async function findUserCfgOptLimited(opts: {
  localAppData?: string
  appData?: string
  timeoutMs: number
}): Promise<string[]> {
  const out: string[] = []
  const start = Date.now()

  const roots: string[] = []
  if (opts.localAppData) roots.push(join(opts.localAppData, 'Packages'))
  if (opts.appData) roots.push(opts.appData)

  for (const root of roots) {
    if (Date.now() - start > opts.timeoutMs) break
    try {
      const found = await walkForFileLimited(root, 'UserCfg.opt', start, opts.timeoutMs, 4)
      if (found) out.push(found)
    } catch {
      // ignore
    }
  }

  return out
}

async function walkForFileLimited(
  root: string,
  fileName: string,
  startMs: number,
  timeoutMs: number,
  maxDepth: number
): Promise<string | null> {
  if (Date.now() - startMs > timeoutMs) return null
  if (maxDepth < 0) return null

  let entries: any[] = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }

  for (const ent of entries) {
    if (Date.now() - startMs > timeoutMs) return null
    if (ent.isFile && ent.isFile() && ent.name.toLowerCase() === fileName.toLowerCase()) {
      return join(root, ent.name)
    }
  }

  for (const ent of entries) {
    if (Date.now() - startMs > timeoutMs) return null
    if (!ent.isDirectory || !ent.isDirectory()) continue
    const name = String(ent.name ?? '')
    // Avoid pathological recursion into huge folders.
    if (name.startsWith('.')) continue

    const res = await walkForFileLimited(join(root, name), fileName, startMs, timeoutMs, maxDepth - 1)
    if (res) return res
  }

  return null
}

export function getTempBaseDir(): string {
  return app.getPath('temp')
}
