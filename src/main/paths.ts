import { dialog, app } from 'electron'
import { access, readFile } from 'fs/promises'
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

  // 1) Parse UserCfg.opt for InstalledPackagesPath (most reliable when present)
  const appData = process.env.APPDATA
  const localAppData = process.env.LOCALAPPDATA
  const roamingCfg = appData ? join(appData, 'Microsoft Flight Simulator', 'UserCfg.opt') : null
  const storeCfg =
    localAppData
      ? join(localAppData, 'Packages', msStorePackageFamilyName, 'LocalCache', 'UserCfg.opt')
      : null

  for (const cfgPath of [roamingCfg, storeCfg].filter(Boolean) as string[]) {
    const installedPackagesPath = await readInstalledPackagesPath(cfgPath)
    if (installedPackagesPath) {
      candidates.push(join(installedPackagesPath, 'Community'))
    }
  }

  // 2) Known fallbacks
  // Steam-ish typical layout
  // %APPDATA%\\Microsoft Flight Simulator\\Packages\\Community
  if (appData) {
    candidates.push(join(appData, 'Microsoft Flight Simulator', 'Packages', 'Community'))
  }

  // Store/Xbox typical
  if (localAppData) {
    candidates.push(join(localAppData, 'Packages', msStorePackageFamilyName, 'LocalCache', 'Packages', 'Community'))
  }

  // 3) User-provided extra candidates
  if (opts?.extraCandidates?.length) {
    candidates.push(...opts.extraCandidates)
  }

  // 4) Fallback: user home (rare)
  candidates.push(join(os.homedir(), 'AppData', 'Roaming', 'Microsoft Flight Simulator', 'Packages', 'Community'))

  // De-dupe, preserve order
  const seen = new Set<string>()
  const unique = candidates.filter((p) => {
    const key = p.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  for (const p of unique) {
    try {
      await verifyWritable(p)
      return p
    } catch {
      // ignore
    }
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

export function getTempBaseDir(): string {
  return app.getPath('temp')
}
