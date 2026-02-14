import type { AddonChannelKey, InstallProgressEvent, LocalState, RemoteManifest } from './types'

export const IPC = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  COMMUNITY_BROWSE: 'community:browse',
  COMMUNITY_DETECT: 'community:detect',
  COMMUNITY_TEST: 'community:test',

  INSTALL_PATH_BROWSE: 'installPath:browse',
  INSTALL_PATH_TEST: 'installPath:test',

  MANIFEST_FETCH: 'manifest:fetch',

  RELEASE_NOTES_FETCH: 'releaseNotes:fetch',

  ADDON_INSTALL: 'addon:install',
  ADDON_UNINSTALL: 'addon:uninstall',
  ADDON_RECONCILE: 'addon:reconcile',

  // App updates (GitHub Releases)
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_QUIT_INSTALL: 'update:quitAndInstall',

  // Live/background update indicator commands (aliases)
  IPC_UPDATE_DOWNLOAD: 'updates:download',
  IPC_UPDATE_INSTALL: 'updates:install',

  // App update events (existing)
  UPDATE_CHECKING: 'update:checking',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_NOT_AVAILABLE: 'update:not-available',
  UPDATE_DOWNLOAD_PROGRESS: 'update:download-progress',
  UPDATE_DOWNLOADED: 'update:downloaded',
  UPDATE_ERROR: 'update:error',

  // Live/background update indicator events
  EVT_UPDATE_AVAILABLE: 'evt:updateAvailable',
  EVT_UPDATE_PROGRESS: 'evt:updateProgress',
  EVT_UPDATE_READY: 'evt:updateReady',

  OPEN_EXTERNAL: 'external:open',
  SYSTEM_LOCALE_GET: 'systemLocale:get',
  SYSTEM_DISKSPACE_GET: 'systemDiskSpace:get',
  SYSTEM_REMOTE_FILE_SIZE_GET: 'systemRemoteFileSize:get',
  // App metadata
  SYSTEM_GET_APP_VERSION: 'systemAppVersion:get',
  // Back-compat alias (internal):
  SYSTEM_APP_VERSION_GET: 'systemAppVersion:get',

  EVT_INSTALL_PROGRESS: 'evt:installProgress',
  EVT_SPLASH_STATUS: 'evt:splashStatus',

  SPLASH_RETRY_CONNECTIVITY: 'splash:retryConnectivity',
  SPLASH_QUIT: 'splash:quit'
} as const

export type IpcSettingsGetResult = LocalState
export type IpcSettingsSetArgs = Partial<LocalState['settings']>

export type IpcManifestFetchArgs = { url?: string }
export type IpcManifestFetchResult = { manifest: RemoteManifest; mode: 'online' | 'offline' }

export type IpcAddonInstallArgs = { addonId: string; channel: AddonChannelKey }
export type IpcAddonUninstallArgs = { addonId: string }

export type IpcAddonReconcileResult = LocalState

export type IpcInstallProgressEvent = InstallProgressEvent

export type IpcOpenExternalArgs = { url: string }

export type IpcSystemDiskSpaceArgs = { targetPath: string }
export type IpcSystemDiskSpaceResult = { freeBytes: number; totalBytes: number }

export type IpcSystemRemoteFileSizeArgs = { url: string }
export type IpcSystemRemoteFileSizeResult = { sizeBytes: number | null }

export type IpcSystemAppVersionResult = { version: string; isPackaged: boolean }

export type IpcReleaseNotesFetchArgs = { url: string }
export type IpcReleaseNotesFetchResult = { statusCode: number; contentType: string; body: string }

export type UpdateAvailablePayload = { version: string; releaseNotes?: string; releaseUrl?: string }
export type UpdateProgressPayload = {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}
export type UpdateDownloadedPayload = { version: string }
export type UpdateErrorPayload = { message: string }

// Live/background update indicator payloads
export type LiveUpdateAvailablePayload = { available: boolean; version?: string }
export type LiveUpdateProgressPayload = { percent: number }
export type LiveUpdateReadyPayload = { version: string }
