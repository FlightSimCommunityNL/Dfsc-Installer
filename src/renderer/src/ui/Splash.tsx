import React, { useEffect, useMemo, useState } from 'react'
import dfscLogo from '../assets/dfsc-logo.png'
import { APP_DISPLAY_NAME } from '@shared/app-info'

type SplashStatus = {
  phase:
    | 'starting'
    | 'checking'
    | 'connecting'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'not-available'
    | 'error'
    | 'offline-blocked'
  message: string
  percent?: number
}

type Lang = 'en' | 'nl'

const dict: Record<Lang, Record<string, string>> = {
  en: {
    starting: 'Starting…',
    checking: 'Checking for updates…',
    connecting: 'Connecting…',
    offlineBlocked: 'No internet connection / server unreachable',
    retry: 'Retry',
    quit: 'Quit',
    closeAuto: 'This window will close automatically.',
    continuing: 'Update check failed. Continuing…',
    downloading: 'Downloading update…',
    installing: 'Installing update…',
  },
  nl: {
    starting: 'Opstarten…',
    checking: 'Controleren op updates…',
    connecting: 'Verbinden…',
    offlineBlocked: 'Geen internetverbinding / server niet bereikbaar',
    retry: 'Opnieuw proberen',
    quit: 'Afsluiten',
    closeAuto: 'Dit venster sluit automatisch.',
    continuing: 'Update check mislukt. Doorgaan…',
    downloading: 'Update downloaden…',
    installing: 'Update installeren…',
  },
}

export function Splash() {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const lang = (params.get('lang') === 'nl' ? 'nl' : 'en') as Lang
  const t = (k: string) => dict[lang][k] ?? k

  const [status, setStatus] = useState<SplashStatus>({
    phase: 'starting',
    message: t('starting'),
  })

  useEffect(() => {
    const off = window.dfsc.splash.onStatus((p: any) => {
      if (!p || typeof p !== 'object') return
      setStatus({
        phase: p.phase ?? 'starting',
        message: String(p.message ?? ''),
        percent: typeof p.percent === 'number' ? p.percent : undefined,
      })
    })
    return () => off()
  }, [])

  const progressText = useMemo(() => {
    if (status.phase !== 'downloading') return null
    if (typeof status.percent !== 'number') return t('downloading')
    return `${t('downloading')} ${status.percent.toFixed(0)}%`
  }, [status.phase, status.percent, lang])

  return (
    <div className="h-full w-full bg-[#101828] text-text-100 flex items-center justify-center">
      <div className="w-[420px] text-center">
        <img src={dfscLogo} className="h-16 w-auto mx-auto" alt="DFSC" draggable={false} />
        <div className="mt-3 text-sm font-semibold whitespace-nowrap">{APP_DISPLAY_NAME}</div>
        <div className="mt-3 text-sm font-semibold">{progressText ?? status.message}</div>

        <div className="mt-5 h-2 bg-bg-900/60 rounded-full overflow-hidden">
          <div
            className="h-2 bg-accent transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, status.phase === 'downloading' ? status.percent ?? 0 : status.phase === 'installing' ? 100 : 0))}%` }}
          />
        </div>

        <div className="mt-3 text-[11px] text-text-400">{t('closeAuto')}</div>

        <div className="mt-5">
          {status.phase === 'offline-blocked' ? (
            <div>
              <div className="text-[11px] text-highlight">{t('offlineBlocked')}</div>
              <div className="mt-3 flex gap-2 justify-center">
                <button
                  className="dsfc-no-drag px-3 py-2 rounded-lg border border-accent2/40 bg-accent2/20 text-xs text-text-200 hover:bg-accent2/30"
                  onClick={() => window.dfsc.splash.retryConnectivity()}
                >
                  {t('retry')}
                </button>
                <button
                  className="dsfc-no-drag px-3 py-2 rounded-lg border border-border bg-bg-800 text-xs text-text-200 hover:bg-bg-700"
                  onClick={() => window.dfsc.splash.quit()}
                >
                  {t('quit')}
                </button>
              </div>
            </div>
          ) : null}

          {status.phase === 'error' ? (
            <div className="mt-2 text-[11px] text-text-400">{t('continuing')}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
