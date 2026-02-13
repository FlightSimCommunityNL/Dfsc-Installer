import updater from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { UpdateAvailablePayload, UpdateDownloadedPayload, UpdateErrorPayload, UpdateProgressPayload } from '@shared/ipc'
import { getGitHubReleasesOwnerRepo, getGitHubReleasePageUrl } from './update-config'

const { autoUpdater } = updater

let currentGetWin: (() => BrowserWindow | null) | null = null

function winSend(channel: string, payload?: any) {
  const win = currentGetWin?.() ?? null
  if (!win) return
  if (payload === undefined) win.webContents.send(channel)
  else win.webContents.send(channel, payload)
}

export function initUpdateManager(getWin: () => BrowserWindow | null) {
  currentGetWin = getWin

  autoUpdater.autoDownload = false

  // Ensure provider is GitHub Releases (placeholders are in update-config.ts).
  const { owner, repo } = getGitHubReleasesOwnerRepo()
  autoUpdater.setFeedURL({ provider: 'github', owner, repo })

  autoUpdater.on('checking-for-update', () => winSend(IPC.UPDATE_CHECKING))

  autoUpdater.on('update-available', (info) => {
    const payload: UpdateAvailablePayload = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseUrl: getGitHubReleasePageUrl(info.version),
    }
    winSend(IPC.UPDATE_AVAILABLE, payload)
  })

  autoUpdater.on('update-not-available', () => winSend(IPC.UPDATE_NOT_AVAILABLE))

  autoUpdater.on('download-progress', (p) => {
    const payload: UpdateProgressPayload = {
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    }
    winSend(IPC.UPDATE_DOWNLOAD_PROGRESS, payload)
  })

  autoUpdater.on('update-downloaded', (info) => {
    const payload: UpdateDownloadedPayload = { version: info.version }
    winSend(IPC.UPDATE_DOWNLOADED, payload)
  })

  autoUpdater.on('error', (err) => {
    const payload: UpdateErrorPayload = { message: err?.message ?? String(err) }
    winSend(IPC.UPDATE_ERROR, payload)
  })
}

export async function checkForUpdates() {
  return autoUpdater.checkForUpdates()
}

export async function downloadUpdate() {
  return autoUpdater.downloadUpdate()
}

export function quitAndInstall() {
  autoUpdater.quitAndInstall()
}
