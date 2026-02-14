import updater from 'electron-updater'
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  LiveUpdateAvailablePayload,
  LiveUpdateProgressPayload,
  LiveUpdateReadyPayload,
  UpdateAvailablePayload,
  UpdateDownloadedPayload,
  UpdateErrorPayload,
  UpdateProgressPayload,
} from '@shared/ipc'
import { getGitHubReleasesOwnerRepo, getGitHubReleasePageUrl } from './update-config'

const { autoUpdater } = updater

let currentGetWin: (() => BrowserWindow | null) | null = null
let pollingTimer: NodeJS.Timeout | null = null

function winSend(channel: string, payload?: any) {
  const win = currentGetWin?.() ?? null
  if (!win) return
  if (payload === undefined) win.webContents.send(channel)
  else win.webContents.send(channel, payload)
}

export function initUpdateManager(getWin: () => BrowserWindow | null) {
  currentGetWin = getWin

  autoUpdater.autoDownload = false

  // Ensure provider is GitHub Releases.
  // Runtime must NOT require a token for public repos; GH_TOKEN is for CI publishing only.
  const { owner, repo } = getGitHubReleasesOwnerRepo()
  autoUpdater.setFeedURL({ provider: 'github', owner, repo })

  // Extra diagnostic: the GitHub provider uses releases.atom for update discovery.
  const atomUrl = `https://github.com/${owner}/${repo}/releases.atom`
  ;(async () => {
    const { app } = await import('electron')
    console.log(
      `[updates] provider=github owner=${owner} repo=${repo} url=${atomUrl} isPackaged=${app.isPackaged} version=${app.getVersion()}`
    )
  })().catch(() => {})

  autoUpdater.on('checking-for-update', () => {
    console.log('[updates] checking-for-update')
    winSend(IPC.UPDATE_CHECKING)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[updates] update available', { version: info?.version })

    // Existing "Updates" panel event
    const payload: UpdateAvailablePayload = {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      releaseUrl: getGitHubReleasePageUrl(info.version),
    }
    winSend(IPC.UPDATE_AVAILABLE, payload)

    // Live titlebar indicator event
    const live: LiveUpdateAvailablePayload = { available: true, version: info.version }
    winSend(IPC.EVT_UPDATE_AVAILABLE, live)
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updates] update-not-available')
    winSend(IPC.UPDATE_NOT_AVAILABLE)

    const live: LiveUpdateAvailablePayload = { available: false }
    winSend(IPC.EVT_UPDATE_AVAILABLE, live)
  })

  autoUpdater.on('download-progress', (p) => {
    const pct = typeof p?.percent === 'number' ? p.percent : 0
    console.log('[updates] download progress', `${pct.toFixed(0)}%`)

    const payload: UpdateProgressPayload = {
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    }
    winSend(IPC.UPDATE_DOWNLOAD_PROGRESS, payload)

    const live: LiveUpdateProgressPayload = { percent: p.percent }
    winSend(IPC.EVT_UPDATE_PROGRESS, live)
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updates] update ready', { version: info?.version })

    const payload: UpdateDownloadedPayload = { version: info.version }
    winSend(IPC.UPDATE_DOWNLOADED, payload)

    const live: LiveUpdateReadyPayload = { version: info.version }
    winSend(IPC.EVT_UPDATE_READY, live)
  })

  autoUpdater.on('error', async (err) => {
    const raw = err?.message ?? String(err)

    let message = raw
    try {
      const { app } = await import('electron')

      // Friendlier mapping for a very common case:
      // - Wrong owner/repo OR
      // - No releases published yet (or draft-only) OR
      // - Repo is private/non-existent
      const is404 = raw.includes(' 404') || raw.toLowerCase().includes('status code: 404') || raw.toLowerCase().includes('not found')
      const mentionsAtom = raw.includes('releases.atom')

      if (!app.isPackaged) {
        message = 'Updates only available in release builds.'
      } else if (is404 && mentionsAtom) {
        message = 'Update check failed (404). No releases published yet, or repo owner/repo is misconfigured.'
      }
    } catch {
      // ignore
    }

    const payload: UpdateErrorPayload = { message }
    console.error('[updates] error', payload.message)
    winSend(IPC.UPDATE_ERROR, payload)
  })
}

export async function checkForUpdates() {
  // Never block dev runs on update checks.
  const { app } = await import('electron')
  if (!app.isPackaged) {
    console.log('[updates] Skip checkForUpdates because application is not packed')
    winSend(IPC.UPDATE_ERROR, { message: 'Updates only available in release builds.' })
    return null
  }
  console.log('[updates] checkForUpdates()')
  return autoUpdater.checkForUpdates()
}

export async function startBackgroundUpdatePolling() {
  const { app } = await import('electron')
  if (!app.isPackaged) return
  if (pollingTimer) return

  const poll = async () => {
    console.log('[updates] polling')
    try {
      await autoUpdater.checkForUpdates()
    } catch (e: any) {
      console.warn('[updates] polling error', e?.message ?? String(e))
    }
  }

  // immediate
  void poll()

  // every 10 minutes
  pollingTimer = setInterval(() => {
    void poll()
  }, 10 * 60 * 1000)
}

export async function downloadUpdate() {
  const { app } = await import('electron')
  if (!app.isPackaged) {
    console.log('[updates] Skip downloadUpdate because application is not packed')
    winSend(IPC.UPDATE_ERROR, { message: 'Updates only available in release builds.' })
    return null
  }
  console.log('[updates] downloadUpdate()')
  return autoUpdater.downloadUpdate()
}

export async function quitAndInstall() {
  const { app } = await import('electron')
  if (!app.isPackaged) {
    console.log('[updates] Skip quitAndInstall because application is not packed')
    winSend(IPC.UPDATE_ERROR, { message: 'Updates only available in release builds.' })
    return
  }
  console.log('[updates] quitAndInstall()')
  autoUpdater.quitAndInstall(false, true)
}
