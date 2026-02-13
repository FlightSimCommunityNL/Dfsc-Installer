import { contextBridge, ipcRenderer } from 'electron'
import type {
  IpcAddonInstallArgs,
  IpcAddonUninstallArgs,
  IpcManifestFetchArgs,
  IpcReleaseNotesFetchResult,
  IpcSettingsSetArgs,
  IpcInstallProgressEvent,
  IpcSystemDiskSpaceResult,
  UpdaterEvent,
} from '@shared/ipc'
import { IPC } from '@shared/ipc'

const api = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: IpcSettingsSetArgs) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
  },
  community: {
    browse: () => ipcRenderer.invoke(IPC.COMMUNITY_BROWSE),
    detect: () => ipcRenderer.invoke(IPC.COMMUNITY_DETECT),
    test: () => ipcRenderer.invoke(IPC.COMMUNITY_TEST),
  },
  installPath: {
    browse: () => ipcRenderer.invoke(IPC.INSTALL_PATH_BROWSE),
    test: () => ipcRenderer.invoke(IPC.INSTALL_PATH_TEST),
    useCommunityFolder: () => ipcRenderer.invoke(IPC.SETTINGS_SET, { installPathMode: 'followCommunity' }),
  },
  manifest: {
    fetch: (args?: IpcManifestFetchArgs) => ipcRenderer.invoke(IPC.MANIFEST_FETCH, args ?? {}),
  },
  releaseNotes: {
    fetch: (url: string): Promise<IpcReleaseNotesFetchResult> => ipcRenderer.invoke(IPC.RELEASE_NOTES_FETCH, { url }),
  },
  addon: {
    install: (args: IpcAddonInstallArgs) => ipcRenderer.invoke(IPC.ADDON_INSTALL, args),
    uninstall: (args: IpcAddonUninstallArgs) => ipcRenderer.invoke(IPC.ADDON_UNINSTALL, args),
    reconcile: () => ipcRenderer.invoke(IPC.ADDON_RECONCILE),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    quitAndInstall: () => ipcRenderer.invoke(IPC.UPDATE_QUIT_INSTALL),
  },
  external: {
    open: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, { url }),
  },
  system: {
    getLocale: () => ipcRenderer.invoke(IPC.SYSTEM_LOCALE_GET),
    getDiskSpace: (targetPath: string): Promise<IpcSystemDiskSpaceResult> =>
      ipcRenderer.invoke(IPC.SYSTEM_DISKSPACE_GET, { targetPath }),
  },
  onInstallProgress: (cb: (evt: IpcInstallProgressEvent) => void) => {
    const listener = (_: unknown, payload: IpcInstallProgressEvent) => cb(payload)
    ipcRenderer.on(IPC.EVT_INSTALL_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.EVT_INSTALL_PROGRESS, listener)
  },
  onLog: (cb: (line: string) => void) => {
    const listener = (_: unknown, payload: string) => cb(payload)
    ipcRenderer.on(IPC.EVT_LOG, listener)
    return () => ipcRenderer.removeListener(IPC.EVT_LOG, listener)
  },
  onUpdateChecking: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.UPDATE_CHECKING, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_CHECKING, listener)
  },
  onUpdateAvailable: (cb: (payload: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on(IPC.UPDATE_AVAILABLE, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_AVAILABLE, listener)
  },
  onUpdateNotAvailable: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on(IPC.UPDATE_NOT_AVAILABLE, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_NOT_AVAILABLE, listener)
  },
  onUpdateProgress: (cb: (payload: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on(IPC.UPDATE_DOWNLOAD_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_DOWNLOAD_PROGRESS, listener)
  },
  onUpdateDownloaded: (cb: (payload: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on(IPC.UPDATE_DOWNLOADED, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_DOWNLOADED, listener)
  },
  onUpdateError: (cb: (payload: any) => void) => {
    const listener = (_: unknown, payload: any) => cb(payload)
    ipcRenderer.on(IPC.UPDATE_ERROR, listener)
    return () => ipcRenderer.removeListener(IPC.UPDATE_ERROR, listener)
  },
  splash: {
    onStatus: (cb: (payload: any) => void) => {
      const listener = (_: unknown, payload: any) => cb(payload)
      ipcRenderer.on(IPC.EVT_SPLASH_STATUS, listener)
      return () => ipcRenderer.removeListener(IPC.EVT_SPLASH_STATUS, listener)
    },
    retryConnectivity: () => ipcRenderer.invoke(IPC.SPLASH_RETRY_CONNECTIVITY),
    quit: () => ipcRenderer.invoke(IPC.SPLASH_QUIT),
  },
}

contextBridge.exposeInMainWorld('dsfc', api)

export type DsfcApi = typeof api
