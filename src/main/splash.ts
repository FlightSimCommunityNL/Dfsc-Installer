import { BrowserWindow } from 'electron'
import { join } from 'path'

type CreateSplashOptions = {
  iconPath: string
  loadUrl?: string
  lang: 'en' | 'nl'
}

export function createSplashWindow(opts: CreateSplashOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#101828',
    center: true,
    alwaysOnTop: true,
    icon: opts.iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const url = opts.loadUrl
  if (url) {
    // Route the renderer to splash mode.
    const u = new URL(url)
    u.searchParams.set('splash', '1')
    u.searchParams.set('lang', opts.lang)
    win.loadURL(u.toString())
  } else {
    // Production build.
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { splash: '1', lang: opts.lang } as any })
  }

  win.once('ready-to-show', () => win.show())
  return win
}
