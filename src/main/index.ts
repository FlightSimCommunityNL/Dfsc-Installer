import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import path from 'path'
import { MACOS_TRAFFIC_LIGHT_POS } from '@shared/windowChrome'
import { APP_DISPLAY_NAME } from '@shared/app-info'
import { registerIpc } from './ipc'
import { initUpdateManager, setUpdateHandoffHandlers, startBackgroundUpdatePolling } from './updater'
import updater from 'electron-updater'
import { IPC } from '@shared/ipc'
import { createSplashWindow } from './splash'
import { getGitHubReleasesOwnerRepo } from './update-config'
import { getAddonManifestUrl } from './config'
import { fetchManifest } from './manifest'
import type { AppSettings } from '@shared/types'

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

let mainWindow: BrowserWindow | null = null
let mainWindowOpening = false
let splashWindow: BrowserWindow | null = null

function closeSplashSafe() {
  try {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
    }
  } catch {
    // ignore
  } finally {
    splashWindow = null
  }
}

app.on('before-quit', () => {
  try {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy()
    }
  } catch {
    // ignore
  }
})

function createWindow(opts?: { autoShow?: boolean }): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  const iconPath =
    isWin
      ? app.isPackaged
        ? path.join(process.resourcesPath, 'icon.ico')
        : path.join(process.cwd(), 'build', 'icon.ico')
      : path.join(process.cwd(), 'build', 'icon.png')

  const win = new BrowserWindow({
    show: false,
    icon: iconPath,
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
    title: APP_DISPLAY_NAME,
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

  const autoShow = opts?.autoShow !== false
  win.once('ready-to-show', () => {
    if (autoShow) win.show()
  })
  return win
}

function splashSend(payload: any) {
  if (!splashWindow) return
  splashWindow.webContents.send(IPC.EVT_SPLASH_STATUS, payload)
}

app.whenReady().then(async () => {
  try {
    const STARTUP_TIMEOUT_MS = 15_000
    const SPLASH_HANG_GUARD_MS = 15_000
    const INSTALL_WATCHDOG_MS = 120_000
    let installingUpdate = false

    console.log('[startup] registering IPC')
    // Register IPC exactly once for the lifetime of the app.
    // Uses a getter so handlers can still send events when mainWindow is created later.
    registerIpc(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null))
    console.log('[startup] IPC registered')

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
  console.log('[startup] creating splash')
  splashWindow = createSplashWindow({
    iconPath: path.join(process.cwd(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    loadUrl: rendererUrl,
    lang: splashLang,
  })
  console.log('[startup] splash shown')

  const openMainWindow = () => {
    if ((mainWindow && !mainWindow.isDestroyed()) || mainWindowOpening) return
    mainWindowOpening = true

    console.log('[startup] creating main')

    mainWindow = createWindow({ autoShow: false })
    initUpdateManager(() => mainWindow)

    setUpdateHandoffHandlers({
      hideMain: () => {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
        } catch {
          // ignore
        }
      },
      showSplash: () => {
        try {
          if (!splashWindow || splashWindow.isDestroyed()) {
            splashWindow = createSplashWindow({
              iconPath: path.join(process.cwd(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
              loadUrl: rendererUrl,
              lang: splashLang,
            })
            console.log('[startup] splash shown')
          } else {
            splashWindow.show()
          }
        } catch {
          // ignore
        }
      },
      sendSplash: (payload: any) => splashSend(payload),
    })

    // Only start polling after renderer has loaded, otherwise live titlebar events
    // can be emitted before the renderer subscribes.
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const { syncLiveUpdateStateToRenderer, checkForUpdates } = await import('./updater')
        syncLiveUpdateStateToRenderer()
        // Silent one-shot check on startup (non-blocking).
        void checkForUpdates().catch(() => {})
      } catch {
        // ignore
      }
      void startBackgroundUpdatePolling()
    })

    mainWindow.once('ready-to-show', () => {
      console.log('[startup] main ready-to-show')
      mainWindowOpening = false
      try {
        mainWindow?.show()
      } catch {
        // ignore
      }
      closeSplashSafe()
      console.log('[startup] splash closed')
    })
  }

  // Hard guard: splash must never hang indefinitely.
  setTimeout(() => {
    if (installingUpdate) return
    if (splashWindow && !splashWindow.isDestroyed()) {
      console.warn('[startup] splash timeout fallback triggered')
      openMainWindow()
    }
  }, SPLASH_HANG_GUARD_MS)

  // Dev mode: skip update gate and start immediately.
  if (!app.isPackaged) {
    splashSend({
      phase: 'starting',
      message: splashLang === 'nl' ? 'Dev mode — starten…' : 'Dev mode — starting…',
    })
    openMainWindow()
    return
  }

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
    if (installingUpdate) return
    try {
      openMainWindow()
    } catch (e: any) {
      console.error('[startup] timeout openMain failed', e)
    }
  }, STARTUP_TIMEOUT_MS)

  try {
    // In dev we still show splash, but never block the main window.

    // Updates are checked silently after the main window is created.
    // Do not block splash/main on update checks.

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
    if (!installingUpdate) {
      console.log('[startup] opening main window')
      try {
        openMainWindow()
      } catch (e: any) {
        console.error('[startup] openMain failed', e)
      }
    }
  }

  void startupError


  async function runManifestGate(opts: { allowBlock: boolean }) {
    splashSend({ phase: 'connecting', message: splashLang === 'nl' ? 'Verbinden…' : 'Connecting…' })

    try {
      // Use the same code path as the app (fetchManifest). It already supports cached offline fallback.
      console.log('[startup] manifest start')
      await promiseWithTimeout(fetchManifest(getAddonManifestUrl(), 0, 5_000), 5_500, 'manifest fetch')
      console.log('[startup] manifest done')
      if (!opts.allowBlock) return
      openMainWindow()
    } catch (e: any) {
      console.error('[manifest error]', e)
      splashSend({ phase: 'offline-blocked', message: splashLang === 'nl' ? 'Geen internetverbinding' : 'No internet connection' })
      if (!opts.allowBlock) return
      openMainWindow()
    }
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
  } catch (err) {
    console.error('[startup] fatal error', err)
    try {
      // Fail-open: attempt to show main window even if startup gating failed.
      if (!mainWindow && !mainWindowOpening) {
        mainWindowOpening = true
        mainWindow = createWindow({ autoShow: true })
      }
      closeSplashSafe()
    } catch {
      // ignore
    }
  }
})

app.on('activate', () => {
  // On macOS, re-create a window when clicking the dock icon.
  if (BrowserWindow.getAllWindows().length !== 0) return
  if (splashWindow && !splashWindow.isDestroyed()) return

  if (mainWindow || mainWindowOpening) return
  mainWindowOpening = true

  mainWindow = createWindow({ autoShow: true })
  mainWindow.once('ready-to-show', () => {
    mainWindowOpening = false
  })

  initUpdateManager(() => mainWindow)

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const { syncLiveUpdateStateToRenderer, checkForUpdates } = await import('./updater')
      syncLiveUpdateStateToRenderer()
      void checkForUpdates().catch(() => {})
    } catch {
      // ignore
    }
    void startBackgroundUpdatePolling()
  })
})

app.on('window-all-closed', () => {
  // Windows-only target, but keep macOS dev behavior.
  if (process.platform !== 'darwin') app.quit()
})
