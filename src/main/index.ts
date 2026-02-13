import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import path from 'path'
import { MACOS_TRAFFIC_LIGHT_POS } from '@shared/windowChrome'
import { registerIpc } from './ipc'
import { initUpdateManager } from './updater'
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

  const win = new BrowserWindow({
    show: false,
    icon: path.join(process.cwd(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: MACOS_TRAFFIC_LIGHT_POS,
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

  // Splash IPC actions
  ipcMain.handle(IPC.SPLASH_QUIT, async () => {
    app.quit()
    return true
  })

  ipcMain.handle(IPC.SPLASH_RETRY_CONNECTIVITY, async () => {
    await runManifestGate({ allowBlock: true })
    return true
  })

  splashSend({ phase: 'starting', message: splashLang === 'nl' ? 'Opstarten…' : 'Starting…' })

  // Packaged: gated updates first.
  if (app.isPackaged) {
    const okToContinue = await runUpdateGate()
    if (!okToContinue) return // will quitAndInstall
  }

  // Then gate on addon manifest connectivity/cache.
  await runManifestGate({ allowBlock: true })

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
        if (!app.isPackaged || process.env.NODE_ENV === 'development') {
          console.warn('[updates] error:', raw)
        }
        const friendly = isLikelyOffline(raw)
          ? splashLang === 'nl'
            ? 'Geen internetverbinding'
            : 'No internet connection'
          : splashLang === 'nl'
            ? 'Updatecontrole mislukt'
            : 'Update check failed'
        splashSend({ phase: 'error', message: friendly })
        // fail open
        setTimeout(() => resolve(true), 600)
      })

      autoUpdater.checkForUpdates().catch((e: any) => {
        cleanup()
        const raw = e?.message ?? String(e)
        if (!app.isPackaged || process.env.NODE_ENV === 'development') {
          console.warn('[updates] checkForUpdates failed:', raw)
        }
        const friendly = isLikelyOffline(raw)
          ? splashLang === 'nl'
            ? 'Geen internetverbinding'
            : 'No internet connection'
          : splashLang === 'nl'
            ? 'Updatecontrole mislukt'
            : 'Update check failed'
        splashSend({ phase: 'error', message: friendly })
        setTimeout(() => resolve(true), 600)
      })
    })
  }

  async function runManifestGate(opts: { allowBlock: boolean }) {
    splashSend({ phase: 'connecting', message: splashLang === 'nl' ? 'Verbinden…' : 'Connecting…' })

    try {
      // Use the same code path as the app (fetchManifest). It already supports cached offline fallback.
      await fetchManifest(getAddonManifestUrl(), 0, 5_000)
      openMainAndCloseSplash()
    } catch (e: any) {
      // If no cached manifest exists, fetchManifest will throw.
      splashSend({ phase: 'offline-blocked', message: e?.message ?? String(e) })
      if (!opts.allowBlock) {
        // fail open (unused, but here for completeness)
        openMainAndCloseSplash()
      }
    }
  }

  function openMainAndCloseSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
    }
    splashWindow = null

    mainWindow = createWindow()
    registerIpc(() => mainWindow)
    initUpdateManager(() => mainWindow)
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
})

app.on('window-all-closed', () => {
  // Windows-only target, but keep macOS dev behavior.
  if (process.platform !== 'darwin') app.quit()
})
