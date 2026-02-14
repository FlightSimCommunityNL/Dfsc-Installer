import { ipcMain, shell, type BrowserWindow } from 'electron'
import { request } from 'undici'
import { join as joinPath } from 'path'
import { IPC } from '@shared/ipc'
import type {
  IpcAddonInstallArgs,
  IpcAddonUninstallArgs,
  IpcManifestFetchArgs,
  IpcReleaseNotesFetchArgs,
  IpcReleaseNotesFetchResult,
  IpcSystemDiskSpaceArgs,
  IpcSystemDiskSpaceResult,
} from '@shared/ipc'
import type { ManifestAddonChannel } from '@shared/types'

import { getDiskSpaceForPath } from './diskspace'

import fse from 'fs-extra'
import { getState, setInstalled, setSettings, store } from './store'
import { browseForCommunityPath, browseForInstallPath, detectCommunityPathWindows, verifyWritable } from './paths'
import { fetchManifest } from './manifest'
import { getAddonManifestUrl } from './config'
import { AddonInstallerService } from './installer'
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updater'

let lastManifestUrl: string | null = null
let lastManifest: Awaited<ReturnType<typeof fetchManifest>> | null = null

function sendLog(getWin: () => BrowserWindow | null, line: string) {
  getWin()?.webContents.send(IPC.EVT_LOG, line)
}

function sendProgress(getWin: () => BrowserWindow | null, evt: any) {
  getWin()?.webContents.send(IPC.EVT_INSTALL_PROGRESS, evt)
}

export function registerIpc(getWin: () => BrowserWindow | null) {
  const installer = new AddonInstallerService(
    (line) => sendLog(getWin, line),
    (evt) => sendProgress(getWin, evt)
  )

  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return getState()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_evt, patch) => {
    const next = setSettings(patch)
    return next
  })

  ipcMain.handle(IPC.COMMUNITY_BROWSE, async () => {
    const win = getWin()
    if (!win) return null
    const picked = await browseForCommunityPath(win)
    if (!picked) return null
    await verifyWritable(picked)
    setSettings({ communityPath: picked })
    return picked
  })

  ipcMain.handle(IPC.COMMUNITY_DETECT, async () => {
    const s = store.get('settings')
    const detected = await detectCommunityPathWindows({
      msStorePackageFamilyName: s.windowsMsStorePackageFamilyName,
      extraCandidates: s.windowsCommunityCandidates,
    })
    if (detected) setSettings({ communityPath: detected })
    return detected
  })

  ipcMain.handle(IPC.COMMUNITY_TEST, async () => {
    const p = store.get('settings').communityPath
    if (!p) throw new Error('Community folder not set')
    if (!(await fse.pathExists(p))) throw new Error('Path does not exist')
    await verifyWritable(p)
    return true
  })

  ipcMain.handle(IPC.INSTALL_PATH_BROWSE, async () => {
    const win = getWin()
    if (!win) return null
    const picked = await browseForInstallPath(win)
    if (!picked) return null
    await verifyWritable(picked)
    setSettings({ installPath: picked, installPathMode: 'custom' })
    return picked
  })

  ipcMain.handle(IPC.INSTALL_PATH_TEST, async () => {
    const s = store.get('settings')
    const p = (s.installPath ?? s.communityPath) as string | null
    if (!p) throw new Error('Install path not set')
    if (!(await fse.pathExists(p))) throw new Error('Path does not exist')
    await verifyWritable(p)
    return true
  })

  ipcMain.handle(IPC.MANIFEST_FETCH, async (_evt, args: IpcManifestFetchArgs) => {
    const url = args?.url ?? getAddonManifestUrl()
    lastManifestUrl = url
    const res = await fetchManifest(url)
    lastManifest = res.manifest
    return res
  })

  ipcMain.handle(IPC.RELEASE_NOTES_FETCH, async (_evt, args: IpcReleaseNotesFetchArgs): Promise<IpcReleaseNotesFetchResult> => {
    const url = String(args?.url ?? '')
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL')

    const res = await request(url, { method: 'GET' })
    const contentType = String(res.headers['content-type'] ?? '')
    const body = await res.body.text()

    // Always return status + body. Renderer handles 404 as "no release notes".
    return { statusCode: res.statusCode, contentType, body }
  })

  ipcMain.handle(IPC.ADDON_RECONCILE, async () => {
    const state = getState()
    const basePath = state.settings.installPath ?? state.settings.communityPath

    const inferInstalledChannel = (opts: { addon: any; installedVersion: string }): 'stable' | 'beta' | 'dev' | 'unknown' | null => {
      const v = String(opts.installedVersion ?? '').trim()
      if (!v || v === 'unknown') return null
      const keys: Array<'stable' | 'beta' | 'dev'> = ['stable', 'beta', 'dev']
      for (const k of keys) {
        const ch = opts.addon?.channels?.[k]
        const remoteVersion = typeof ch?.version === 'string' ? ch.version : null
        if (remoteVersion && remoteVersion === v) return k
      }
      return 'unknown'
    }

    // If installPath/communityPath isn't set, just prune missing paths from stored state.
    if (!basePath) {
      const installed = { ...state.installed }
      for (const [addonId, rec] of Object.entries(installed)) {
        const exists = await Promise.all(rec.installedPaths.map((p) => fse.pathExists(p)))
        if (exists.some((x) => !x)) setInstalled(addonId, null)
      }
      return getState()
    }

    // Fetch manifest so we can map folders -> addon IDs.
    const manifest = lastManifest ?? (await fetchManifest(lastManifestUrl ?? getAddonManifestUrl()))
    lastManifest = manifest

    // Scan install path folder: top-level directories.
    let communityDirs: string[] = []
    try {
      const entries = await fse.readdir(basePath, { withFileTypes: true })
      communityDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch (err: any) {
      sendLog(getWin, `[installPath] ERROR reading install folder: ${err?.message ?? String(err)}`)
      return getState()
    }

    // Read MSFS package manifests (best-effort) for version inference.
    const folderMeta = new Map<string, { installedVersion?: string }>()
    await Promise.all(
      communityDirs.map(async (dir) => {
        const manifestPath = joinPath(basePath, dir, 'manifest.json')
        try {
          if (!(await fse.pathExists(manifestPath))) return
          const json = await fse.readJson(manifestPath)
          const v =
            (typeof json?.package_version === 'string' && json.package_version) ||
            (typeof json?.packageVersion === 'string' && json.packageVersion) ||
            (typeof json?.version === 'string' && json.version) ||
            undefined
          if (v) folderMeta.set(dir.toLowerCase(), { installedVersion: v })
        } catch {
          // ignore malformed manifest
        }
      })
    )

    // Build a reverse lookup from folder name -> addonId using manifest.packageFolderNames.
    // If multiple addons claim the same folder, we ignore that mapping.
    const folderToAddon = new Map<string, string>()
    const conflicts = new Set<string>()

    for (const addon of manifest.addons) {
      const folders = addon.packageFolderNames ?? []
      for (const folder of folders) {
        const key = folder.toLowerCase()
        if (folderToAddon.has(key) && folderToAddon.get(key) !== addon.id) {
          conflicts.add(key)
        } else {
          folderToAddon.set(key, addon.id)
        }
      }

      // Optional: if no explicit packageFolderNames, allow matching by addon.id as folder name.
      // This is a convention-based fallback.
      if (!folders.length) {
        const key = addon.id.toLowerCase()
        if (!folderToAddon.has(key)) folderToAddon.set(key, addon.id)
      }
    }

    for (const c of conflicts) folderToAddon.delete(c)

    // Determine which addons appear installed based on folders present.
    const foundByAddon = new Map<string, string[]>()
    for (const dir of communityDirs) {
      const addonId = folderToAddon.get(dir.toLowerCase())
      if (!addonId) continue
      const arr = foundByAddon.get(addonId) ?? []
      arr.push(dir)
      foundByAddon.set(addonId, arr)
    }

    // 1) Remove stale installed records whose expected folders no longer exist.
    // 2) Update installedPaths to what we currently observe.
    for (const [addonId, rec] of Object.entries(state.installed)) {
      const observedFolders = foundByAddon.get(addonId)

      // If none of its folders are present anymore, drop it.
      if (!observedFolders?.length) {
        // As a fallback, if installedPaths still exist, keep the record.
        const stillExists = await Promise.all(rec.installedPaths.map((p) => fse.pathExists(p)))
        if (stillExists.some(Boolean)) continue
        setInstalled(addonId, null)
        continue
      }

      // Update paths to current observed folders under Community.
      const observedPaths = observedFolders.map((f) => joinPath(basePath, f))
      const missing = await Promise.all(observedPaths.map((p) => fse.pathExists(p)))
      const validObservedPaths = observedPaths.filter((_, i) => missing[i])

      if (validObservedPaths.length) {
        // If we can infer a version from any observed folder manifest.json, prefer it when current is unknown.
        let inferred: string | undefined
        for (const f of observedFolders) {
          const v = folderMeta.get(f.toLowerCase())?.installedVersion
          if (v) {
            inferred = v
            break
          }
        }

        const addon = manifest.addons.find((a) => a.id === addonId)
        const installedVersion = rec.installedVersion === 'unknown' && inferred ? inferred : rec.installedVersion

        setInstalled(addonId, {
          ...rec,
          installed: true,
          installedPaths: validObservedPaths,
          installedVersion,
          installPath: rec.installPath ?? basePath,
          installedChannel: addon ? inferInstalledChannel({ addon, installedVersion }) : (rec as any).installedChannel ?? 'unknown',
        } as any)
      }
    }

    // 3) Add new records for addons that are present in Community but not in store.
    const nextState = getState()
    for (const [addonId, folders] of foundByAddon.entries()) {
      if (nextState.installed[addonId]) continue

      const installedPaths = folders.map((f) => joinPath(basePath, f))
      const exists = await Promise.all(installedPaths.map((p) => fse.pathExists(p)))
      const valid = installedPaths.filter((_, i) => exists[i])
      if (!valid.length) continue

      let inferred: string | undefined
      for (const f of folders) {
        const v = folderMeta.get(f.toLowerCase())?.installedVersion
        if (v) {
          inferred = v
          break
        }
      }

      const addon = manifest.addons.find((a) => a.id === addonId)
      const installedVersion = inferred ?? 'unknown'

      setInstalled(addonId, {
        addonId,
        installed: true,
        installedChannel: addon ? inferInstalledChannel({ addon, installedVersion }) : 'unknown',
        installedVersion,
        installPath: basePath,
        installedAt: new Date().toISOString(),
        installedPaths: valid,
      })
    }

    // Optional: warn about folders that look like packages but are unknown to manifest.
    // We keep it silent for now.

    // Also: if communityDirs is empty, do nothing.
    return getState()
  })

  ipcMain.handle(IPC.ADDON_INSTALL, async (_evt, args: IpcAddonInstallArgs) => {
    try {
      const state = getState()
      const installPath = state.settings.installPath ?? state.settings.communityPath
      if (!installPath) throw new Error('Install path not set')

      const existing = state.installed[args.addonId]
      if (existing && existing.installed === true) {
        const installedChannel = (existing as any).installedChannel
        if (installedChannel && installedChannel !== 'unknown' && installedChannel !== args.channel) {
          throw new Error('Channel switch not allowed. Uninstall current channel first.')
        }
      }

      const manifest = lastManifest ?? (await fetchManifest(lastManifestUrl ?? getAddonManifestUrl()))
      const addon = manifest.addons.find((a) => a.id === args.addonId)
      if (!addon) throw new Error(`Addon not found in manifest: ${args.addonId}`)

      const channel = addon.channels[args.channel] as ManifestAddonChannel | undefined
      if (!channel) throw new Error(`Channel not available: ${args.channel}`)

      const result = await installer.installAddon({ addon, channel, installPath, channelKey: args.channel })
      setInstalled(addon.id, {
        addonId: addon.id,
        installed: true,
        installedChannel: args.channel,
        installedVersion: result.installedVersion,
        installPath,
        installedAt: new Date().toISOString(),
        installedPaths: result.installedPaths,
      })

      return getState()
    } catch (err: any) {
      sendLog(getWin, `[${args.addonId}] ERROR: ${err?.message ?? String(err)}`)
      // Let renderer still see the error via rejected promise
      throw err
    }
  })

  ipcMain.handle(IPC.ADDON_UNINSTALL, async (_evt, args: IpcAddonUninstallArgs) => {
    try {
      const state = getState()
      const rec = state.installed[args.addonId]
      if (!rec) return state

      await installer.uninstallAddon({ addonId: args.addonId, installedPaths: rec.installedPaths })
      setInstalled(args.addonId, null)
      return getState()
    } catch (err: any) {
      sendLog(getWin, `[${args.addonId}] ERROR: ${err?.message ?? String(err)}`)
      throw err
    }
  })

  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    return checkForUpdates()
  })

  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async () => {
    return downloadUpdate()
  })

  ipcMain.handle(IPC.UPDATE_QUIT_INSTALL, async () => {
    return quitAndInstall()
  })

  // Live/background update indicator IPC aliases
  ipcMain.handle(IPC.IPC_UPDATE_DOWNLOAD, async () => {
    return downloadUpdate()
  })

  ipcMain.handle(IPC.IPC_UPDATE_INSTALL, async () => {
    return quitAndInstall()
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, async (_evt, args: { url: string }) => {
    // Only allow http(s) links.
    const url = String(args?.url ?? '')
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL')
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle(IPC.SYSTEM_LOCALE_GET, async () => {
    // Prefer Electron locale from main.
    try {
      const { app } = await import('electron')
      return app.getLocale()
    } catch {
      return null
    }
  })

  ipcMain.handle(
    IPC.SYSTEM_DISKSPACE_GET,
    async (_evt, args: IpcSystemDiskSpaceArgs): Promise<IpcSystemDiskSpaceResult> => {
      return getDiskSpaceForPath(args?.targetPath)
    }
  )
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path.slice(1) : path
  return `${b}/${p}`
}
