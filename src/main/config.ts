import { app } from 'electron'
import { join } from 'path'
import fse from 'fs-extra'

export const DEFAULT_ADDON_MANIFEST_BASE_URL = 'https://redserv.synology.me/dfsc-addons'
export const DEFAULT_APP_UPDATE_BASE_URL = 'https://nas.example.com/app-updates'

export type AdminOverrideConfig = {
  addonManifestBaseUrl?: string
  appUpdateBaseUrl?: string
}

export type ResolvedConfig = {
  addonManifestBaseUrl: string
  appUpdateBaseUrl: string
  adminOverridePathTried: string
}

let resolved: ResolvedConfig | null = null

export async function initConfig(): Promise<ResolvedConfig> {
  const overridePath = getAdminOverridePath()

  const base: ResolvedConfig = {
    addonManifestBaseUrl: DEFAULT_ADDON_MANIFEST_BASE_URL,
    appUpdateBaseUrl: DEFAULT_APP_UPDATE_BASE_URL,
    adminOverridePathTried: overridePath,
  }

  try {
    if (await fse.pathExists(overridePath)) {
      const json = (await fse.readJson(overridePath)) as AdminOverrideConfig
      if (json?.addonManifestBaseUrl && typeof json.addonManifestBaseUrl === 'string') {
        base.addonManifestBaseUrl = json.addonManifestBaseUrl
      }
      if (json?.appUpdateBaseUrl && typeof json.appUpdateBaseUrl === 'string') {
        base.appUpdateBaseUrl = json.appUpdateBaseUrl
      }
    }
  } catch {
    // ignore invalid override files; defaults remain
  }

  resolved = {
    ...base,
    addonManifestBaseUrl: stripTrailingSlash(base.addonManifestBaseUrl),
    appUpdateBaseUrl: stripTrailingSlash(base.appUpdateBaseUrl),
  }

  return resolved
}

export function getConfig(): ResolvedConfig {
  if (!resolved) {
    // If initConfig wasn't called yet, fall back to defaults.
    resolved = {
      addonManifestBaseUrl: stripTrailingSlash(DEFAULT_ADDON_MANIFEST_BASE_URL),
      appUpdateBaseUrl: stripTrailingSlash(DEFAULT_APP_UPDATE_BASE_URL),
      adminOverridePathTried: getAdminOverridePath(),
    }
  }
  return resolved
}

export function getAddonManifestUrl(): string {
  return joinUrl(getConfig().addonManifestBaseUrl, 'manifest.json')
}

export function getAppUpdateBaseUrl(): string {
  return getConfig().appUpdateBaseUrl
}

function getAdminOverridePath(): string {
  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData'
    return join(programData, 'DsfcInstaller', 'config.json')
  }

  // macOS dev-only (and other platforms): ~/Library/Application Support/DsfcInstaller/config.json
  // app.getPath('appData') resolves to ~/Library/Application Support on macOS.
  const appData = app.getPath('appData')
  return join(appData, 'DsfcInstaller', 'config.json')
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function joinUrl(base: string, path: string): string {
  const b = stripTrailingSlash(base)
  const p = path.startsWith('/') ? path.slice(1) : path
  return `${b}/${p}`
}
