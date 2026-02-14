import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import path from 'path'
import { MACOS_TRAFFIC_LIGHT_POS } from '@shared/windowChrome'
import { registerIpc } from './ipc'
import { initUpdateManager, startBackgroundUpdatePolling } from './updater'
import updater from 'electron-updater'
import { IPC } from '@shared/ipc'
import { createSplashWindow } from './splash'
import { getGitHubReleasesOwnerRepo } from './update-config'
import { getAddonManifestUrl } from './config'
import { fetchManifest } from './manifest'
import type { AppSettings } from '@shared/types'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  const win = new BrowserWindow({
    show: false,
    icon: path.join(process.cwd(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: MACOS_TRAFFIC_LIGHT_POS,
        }
      : isWin
        ? {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: {
              color: '#101828',
              symbolColor: '#ffffff',
              height: 44,
            },
          }
        : {}),
    width: 1220,
    height: 760,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    title: 'Dfsc Installer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => win.show())
  return win
}

function splashSend(payload: any) {
  if (!splashWindow) return
  splashWindow.webContents.send(IPC.EVT_SPLASH_STATUS, payload)
}

app.whenReady().then(async () => {
  const STARTUP_TIMEOUT_MS = 6_000

  // Windows: remove default application menu bar (File/Edit/View/...).
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null)
  }

  // Load hardcoded defaults + optional admin override before using manifest/updater URLs.
  const { initConfig } = await import('./config')
  await initConfig()

  // macOS dev: set a branded Dock icon (Electron defaults otherwise).
  if (process.platform === 'darwin') {
    try {
      app.dock.setIcon(path.join(process.cwd(), 'build', 'icon.png'))
    } catch (e: any) {
      console.warn('[dock] setIcon failed:', e?.message ?? String(e))
    }
  }

  // Determine splash language (no network dependency).
  const splashLang = await resolveSplashLang()

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  splashWindow = createSplashWindow({
    iconPath: path.join(process.cwd(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    loadUrl: rendererUrl,
    lang: splashLang,
  })
  console.log('[startup] splash shown')

  // Splash IPC actions
  ipcMain.handle(IPC.SPLASH_QUIT, async () => {
    app.quit()
    return true
  })

  ipcMain.handle(IPC.SPLASH_RETRY_CONNECTIVITY, async () => {
    // Retry manifest fetch, but never block opening the main window.
    void runManifestGate({ allowBlock: false })
    return true
  })

  splashSend({ phase: 'starting', message: splashLang === 'nl' ? 'Opstarten…' : 'Starting…' })

  let startupError: any = null
  const startupTimeout = setTimeout(() => {
    console.warn('[startup] timeout fallback triggered')
    try {
      openMainAndCloseSplash()
    } catch (e: any) {
      console.error('[startup] timeout openMain failed', e)
    }
  }, STARTUP_TIMEOUT_MS)

  try {
    // In dev we still show splash, but never block the main window.

    if (app.isPackaged) {
      try {
        await promiseWithTimeout(runUpdateGate(), 10_000, 'update gate')
      } catch (err) {
        console.error('[updater error]', err)
      }
    }

    try {
      console.log('[startup] manifest start')
      await promiseWithTimeout(fetchManifest(getAddonManifestUrl(), 0, 5_000), 5_500, 'manifest fetch')
      console.log('[startup] manifest done')
    } catch (err) {
      console.error('[manifest error]', err)
      startupError = err
    }
  } catch (err) {
    console.error('[unexpected startup error]', err)
    startupError = err
  } finally {
    clearTimeout(startupTimeout)
    console.log('[startup] opening main window')
    try {
      openMainAndCloseSplash()
    } catch (e: any) {
      console.error('[startup] openMain failed', e)
    }
    console.log('[startup] splash closed')
  }

  void startupError

  async function runUpdateGate(): Promise<boolean> {
    splashSend({ phase: 'checking', message: splashLang === 'nl' ? 'Controleren op updates…' : 'Checking for updates…' })

    const { owner, repo } = getGitHubReleasesOwnerRepo()
    const placeholder =
      !owner ||
      !repo ||
      owner.toUpperCase().includes('PLACEHOLDER') ||
      repo.toUpperCase().includes('PLACEHOLDER')

    if (placeholder) {
      if (!app.isPackaged || process.env.NODE_ENV === 'development') {
        console.log('[updates] skipped: not configured (placeholders)')
      }
      splashSend({
        phase: 'not-available',
        message: splashLang === 'nl' ? 'Updates niet geconfigureerd' : 'Updates not configured',
      })
      // brief UX pause, then continue
      await new Promise((r) => setTimeout(r, 400))
      return true
    }

    const { autoUpdater } = updater
    autoUpdater.autoDownload = true

    autoUpdater.setFeedURL({ provider: 'github', owner, repo })

    const isLikelyOffline = (msg: string) => {
      const m = msg.toLowerCase()
      return (
        m.includes('enetunreach') ||
        m.includes('eai_again') ||
        m.includes('enotfound') ||
        m.includes('ecconnrefused') ||
        m.includes('econnrefused') ||
        m.includes('etimedout') ||
        m.includes('network')
      )
    }

    return new Promise<boolean>((resolve) => {
      const cleanup = () => {
        autoUpdater.removeAllListeners('checking-for-update')
        autoUpdater.removeAllListeners('update-available')
        autoUpdater.removeAllListeners('download-progress')
        autoUpdater.removeAllListeners('update-downloaded')
        autoUpdater.removeAllListeners('update-not-available')
        autoUpdater.removeAllListeners('error')
      }

      autoUpdater.on('checking-for-update', () => {
        splashSend({ phase: 'checking', message: splashLang === 'nl' ? 'Controleren op updates…' : 'Checking for updates…' })
      })

      autoUpdater.on('update-available', async (info) => {
        splashSend({ phase: 'available', message: `Update available: v${info?.version ?? ''}` })
        try {
          await autoUpdater.downloadUpdate()
        } catch (e: any) {
          cleanup()
          splashSend({ phase: 'error', message: e?.message ?? String(e) })
          // fail open to manifest gate
          resolve(true)
        }
      })

      autoUpdater.on('download-progress', (p) => {
        splashSend({ phase: 'downloading', message: splashLang === 'nl' ? 'Update downloaden…' : 'Downloading update…', percent: p?.percent ?? 0 })
      })

      autoUpdater.on('update-downloaded', () => {
        cleanup()
        splashSend({ phase: 'installing', message: splashLang === 'nl' ? 'Update installeren…' : 'Installing update…' })
        setTimeout(() => {
          autoUpdater.quitAndInstall(false, true)
        }, 1200)
        resolve(false)
      })

      autoUpdater.on('update-not-available', () => {
        cleanup()
        resolve(true)
      })

      autoUpdater.on('error', (err) => {
        cleanup()
        const raw = err?.message ?? String(err)
        console.warn('[updates] error:', raw)
        if (err?.stack) console.warn('[updates] error.stack:', err.stack)

        // Always fail-open with a non-scary message.
        const friendly = splashLang === 'nl'
          ? 'Updatecontrole mislukt (offline of niet beschikbaar). Starten…'
          : 'Update check failed (offline or unavailable). Starting…'

        splashSend({ phase: 'checking', message: friendly })
        setTimeout(() => resolve(true), 1200)
      })

      autoUpdater.checkForUpdates().catch((e: any) => {
        cleanup()
        const raw = e?.message ?? String(e)
        console.warn('[updates] checkForUpdates failed:', raw)
        if (e?.stack) console.warn('[updates] checkForUpdates stack:', e.stack)

        const friendly = splashLang === 'nl'
          ? 'Updatecontrole mislukt (offline of niet beschikbaar). Starten…'
          : 'Update check failed (offline or unavailable). Starting…'

        splashSend({ phase: 'checking', message: friendly })
        setTimeout(() => resolve(true), 1200)
      })
    })
  }

  async function runManifestGate(opts: { allowBlock: boolean }) {
    splashSend({ phase: 'connecting', message: splashLang === 'nl' ? 'Verbinden…' : 'Connecting…' })

    try {
      // Use the same code path as the app (fetchManifest). It already supports cached offline fallback.
      console.log('[startup] manifest start')
      await promiseWithTimeout(fetchManifest(getAddonManifestUrl(), 0, 5_000), 5_500, 'manifest fetch')
      console.log('[startup] manifest done')
      if (!opts.allowBlock) return
      openMainAndCloseSplash()
    } catch (e: any) {
      console.error('[manifest error]', e)
      splashSend({ phase: 'offline-blocked', message: splashLang === 'nl' ? 'Geen internetverbinding' : 'No internet connection' })
      if (!opts.allowBlock) return
      openMainAndCloseSplash()
    }
  }

  function openMainAndCloseSplash() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // already open
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close()
        splashWindow = null
      }
      return
    }

    mainWindow = createWindow()
    registerIpc(() => mainWindow)
    initUpdateManager(() => mainWindow)
    void startBackgroundUpdatePolling()

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
    }
    splashWindow = null
  }

  function promiseWithTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      p.then(
        (v) => {
          clearTimeout(t)
          resolve(v)
        },
        (e) => {
          clearTimeout(t)
          reject(e)
        }
      )
    })
  }

  async function resolveSplashLang(): Promise<'en' | 'nl'> {
    try {
      const { store } = await import('./store')
      const settings = store.get('settings') as AppSettings
      const mode = settings?.languageMode
      if (mode === 'nl' || mode === 'en') return mode
    } catch {
      // ignore
    }

    const locale = app.getLocale()
    return locale?.toLowerCase().startsWith('nl') ? 'nl' : 'en'
  }
})

app.on('activate', () => {
  // On macOS, re-create a window when clicking the dock icon.
  if (BrowserWindow.getAllWindows().length !== 0) return
  if (splashWindow && !splashWindow.isDestroyed()) return

  mainWindow = createWindow()
  registerIpc(() => mainWindow)
  initUpdateManager(() => mainWindow)
  void startBackgroundUpdatePolling()
})

app.on('window-all-closed', () => {
  // Windows-only target, but keep macOS dev behavior.
  if (process.platform !== 'darwin') app.quit()
})
