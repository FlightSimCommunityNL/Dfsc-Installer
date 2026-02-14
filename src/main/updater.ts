import updater from 'electron-updater'
import { app, type BrowserWindow } from 'electron'
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
import { ALLOW_PRERELEASE_UPDATES, getGitHubReleasesOwnerRepo, getGitHubReleasePageUrl } from './update-config'

const { autoUpdater } = updater

type UpdateControllerState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'installing'; version?: string }
  | { kind: 'error'; message: string }

let controllerState: UpdateControllerState = { kind: 'idle' }

let currentGetWin: (() => BrowserWindow | null) | null = null
let pollingTimer: NodeJS.Timeout | null = null

let handoff: null | {
  hideMain: () => void
  showSplash: () => void
  sendSplash: (payload: any) => void
} = null

export function setUpdateHandoffHandlers(h: {
  hideMain: () => void
  showSplash: () => void
  sendSplash: (payload: any) => void
}) {
  handoff = h
}

export function getUpdateControllerState(): UpdateControllerState {
  return controllerState
}

export async function installUpdateViaSplashHandoff() {
  const { app } = await import('electron')
  if (!app.isPackaged) {
    console.log('[updates] install skipped: not packaged')
    return
  }

  if (controllerState.kind !== 'downloaded') {
    throw new Error('Update is not ready to install yet.')
  }

  console.log('[updates] install handoff -> splash')
  controllerState = { kind: 'installing', version: controllerState.version }

  try {
    handoff?.hideMain()
    handoff?.showSplash()
    handoff?.sendSplash({ phase: 'installing', message: 'Installing update…' })
  } catch {
    // ignore
  }

  await new Promise((r) => setTimeout(r, 600))
  // Force silent install for NSIS (/S).
  autoUpdater.quitAndInstall(true, true)
}

function winSend(channel: string, payload?: any) {
  const win = currentGetWin?.() ?? null
  if (!win) return
  if (payload === undefined) win.webContents.send(channel)
  else win.webContents.send(channel, payload)
}

export function syncLiveUpdateStateToRenderer() {
  // Re-emit current state so the renderer (TitleBar) can show the indicator even
  // if the updater events fired before the renderer subscribed.
  const state = controllerState

  if (state.kind === 'available') {
    const live: LiveUpdateAvailablePayload = { available: true, version: state.version }
    winSend(IPC.EVT_UPDATE_AVAILABLE, live)
    return
  }

  if (state.kind === 'downloading') {
    const liveA: LiveUpdateAvailablePayload = { available: true }
    winSend(IPC.EVT_UPDATE_AVAILABLE, liveA)
    const liveP: LiveUpdateProgressPayload = { percent: state.percent }
    winSend(IPC.EVT_UPDATE_PROGRESS, liveP)
    return
  }

  if (state.kind === 'downloaded' || state.kind === 'installing') {
    const liveA: LiveUpdateAvailablePayload = { available: true }
    winSend(IPC.EVT_UPDATE_AVAILABLE, liveA)
    const liveR: LiveUpdateReadyPayload = { version: (state as any).version }
    winSend(IPC.EVT_UPDATE_READY, liveR)
    return
  }

  // idle/checking/error => hide
  const live: LiveUpdateAvailablePayload = { available: false }
  winSend(IPC.EVT_UPDATE_AVAILABLE, live)
}

export function initUpdateManager(getWin: () => BrowserWindow | null) {
  currentGetWin = getWin

  // In dev builds, skip updater entirely.
  if (!app.isPackaged) {
    console.log('[updates] initUpdateManager skipped: not packaged')
    return
  }

  // In release builds we want Discord-like behavior: download in background and install immediately.
  autoUpdater.autoDownload = true

  // Ensure provider is GitHub Releases.
  // Runtime must NOT require a token for public repos; GH_TOKEN is for CI publishing only.
  const { owner, repo } = getGitHubReleasesOwnerRepo()
  autoUpdater.setFeedURL({ provider: 'github', owner, repo })

  // Optional: allow pre-release updates.
  autoUpdater.allowPrerelease = !!ALLOW_PRERELEASE_UPDATES

  // Optional runtime token for private repos.
  // If repo is private, GitHub may return 404 to anonymous requests.
  const runtimeToken = process.env.DFSC_GH_UPDATER_TOKEN
  if (typeof runtimeToken === 'string' && runtimeToken.trim()) {
    autoUpdater.requestHeaders = {
      ...(autoUpdater.requestHeaders ?? {}),
      Authorization: `token ${runtimeToken.trim()}`,
    }
  }

  // Extra diagnostic: the GitHub provider uses releases.atom for update discovery.
  const atomUrl = `https://github.com/${owner}/${repo}/releases.atom`
  ;(async () => {
    const { app } = await import('electron')
    console.log(
      `[updates] provider=github owner=${owner} repo=${repo} url=${atomUrl} isPackaged=${app.isPackaged} version=${app.getVersion()} allowPrerelease=${autoUpdater.allowPrerelease} token=${runtimeToken ? 'yes' : 'no'}`
    )
  })().catch(() => {})

  autoUpdater.on('checking-for-update', () => {
    console.log('[updates] checking-for-update')
    controllerState = { kind: 'checking' }
    winSend(IPC.UPDATE_CHECKING)
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[updates] update available', { version: info?.version, releaseName: (info as any)?.releaseName })
    controllerState = { kind: 'available', version: info.version }

    // Auto-download immediately (production).
    if (app.isPackaged) {
      try {
        void autoUpdater.downloadUpdate()
      } catch {
        // ignore; error event will fire
      }
    }

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
    controllerState = { kind: 'idle' }
    winSend(IPC.UPDATE_NOT_AVAILABLE)

    const live: LiveUpdateAvailablePayload = { available: false }
    winSend(IPC.EVT_UPDATE_AVAILABLE, live)
  })

  autoUpdater.on('download-progress', (p) => {
    const pct = typeof p?.percent === 'number' ? p.percent : 0
    controllerState = { kind: 'downloading', percent: pct }
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
    console.log('[updates] update ready', { version: info?.version, downloadedFile: (info as any)?.downloadedFile })
    controllerState = { kind: 'downloaded', version: info.version }

    // Auto-install immediately (production, silent).
    try {
      controllerState = { kind: 'installing', version: info.version }
      handoff?.hideMain()
      handoff?.showSplash()
      handoff?.sendSplash({ phase: 'installing', message: 'Installing update…' })
    } catch {
      // ignore
    }

    setTimeout(() => {
      try {
        if (!app.isPackaged) return
        // Force silent install for NSIS (/S).
        autoUpdater.quitAndInstall(true, true)
      } catch {
        // ignore
      }
    }, 800)

    const payload: UpdateDownloadedPayload = { version: info.version }
    winSend(IPC.UPDATE_DOWNLOADED, payload)

    const live: LiveUpdateReadyPayload = { version: info.version }
    winSend(IPC.EVT_UPDATE_READY, live)
  })

  autoUpdater.on('error', async (err) => {
    const raw = err?.message ?? String(err)

    // High-signal diagnostics for classification.
    console.error('[updates] error.message:', raw)
    if (err?.stack) console.error('[updates] error.stack:', err.stack)

    const anyErr: any = err as any
    const statusCode = anyErr?.statusCode ?? anyErr?.response?.statusCode ?? anyErr?.res?.statusCode
    if (statusCode) console.error('[updates] error.statusCode:', statusCode)
    const body = anyErr?.response?.body ?? anyErr?.responseBody ?? anyErr?.body
    if (typeof body === 'string' && body.trim()) {
      // Avoid dumping huge bodies.
      console.error('[updates] error.responseBody:', body.slice(0, 800))
    }

    let message = raw

    try {
      const { app } = await import('electron')
      const { owner, repo } = getGitHubReleasesOwnerRepo()
      const atomUrl = `https://github.com/${owner}/${repo}/releases.atom`
      const hasToken = typeof process.env.DFSC_GH_UPDATER_TOKEN === 'string' && !!process.env.DFSC_GH_UPDATER_TOKEN.trim()

      // Classify 404 realistically. NOTE: GitHub returns 404 for private repos too.
      const is404 =
        String(statusCode) === '404' ||
        raw.includes(' 404') ||
        raw.toLowerCase().includes('status code: 404') ||
        raw.toLowerCase().includes('not found')
      const mentionsAtom = raw.includes('releases.atom') || raw.includes(atomUrl)

      if (!app.isPackaged) {
        message = 'Updates only available in release builds.'
      } else if (is404 && mentionsAtom) {
        if (!hasToken) {
          message =
            'Updates unavailable: repo is private/not accessible, or the owner/repo is wrong, or the latest release is draft-only. ' +
            'Make the repo public or provide DFSC_GH_UPDATER_TOKEN.'
        } else {
          message = 'Update check failed (404). Owner/repo may be wrong, or releases are not published.'
        }
      }
    } catch {
      // ignore
    }

    const payload: UpdateErrorPayload = { message }
    controllerState = { kind: 'error', message }
    console.error('[updates] error (user-facing):', payload.message)
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

  const { owner, repo } = getGitHubReleasesOwnerRepo()
  const atomUrl = `https://github.com/${owner}/${repo}/releases.atom`
  console.log(`[updates] isPackaged=${app.isPackaged} version=${app.getVersion()}`)
  console.log(`[updates] feed provider=github owner=${owner} repo=${repo}`)
  console.log(`[updates] expected atom url=${atomUrl}`)

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
  // Force silent install for NSIS (/S).
  autoUpdater.quitAndInstall(true, true)
}
