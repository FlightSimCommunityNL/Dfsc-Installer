import React, { useEffect, useMemo, useState } from 'react'
import dfscLogo from '../assets/dfsc-logo.png'
import { MACOS_TRAFFIC_INSET_X, TITLEBAR_HEIGHT } from '@shared/windowChrome'
import { APP_DISPLAY_NAME } from '@shared/app-info'

type UpdateUiState =
  | { kind: 'hidden' }
  | { kind: 'available'; version?: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version?: string }

export function TitleBar(props: { title?: string; offline?: boolean; version?: string | null }) {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const insetX = isMac ? MACOS_TRAFFIC_INSET_X : 0

  const [updateState, setUpdateState] = useState<UpdateUiState>({ kind: 'hidden' })

  useEffect(() => {
    const api: any = (window as any).dfsc
    const updates = api?.updates
    if (!updates?.onAvailable || !updates?.onProgress || !updates?.onReady) return

    const offA = updates.onAvailable((p: any) => {
      if (p?.available) setUpdateState({ kind: 'available', version: p?.version })
      else setUpdateState({ kind: 'hidden' })
    })
    const offP = updates.onProgress((p: any) => {
      const pct = typeof p?.percent === 'number' ? p.percent : 0
      setUpdateState({ kind: 'downloading', percent: Math.max(0, Math.min(100, pct)) })
    })
    const offR = updates.onReady((p: any) => {
      setUpdateState({ kind: 'ready', version: p?.version })
    })

    return () => {
      offA?.()
      offP?.()
      offR?.()
    }
  }, [])

  const updateTooltip = useMemo(() => {
    if (updateState.kind === 'available') return 'Update available'
    if (updateState.kind === 'downloading') return `Downloading… ${updateState.percent.toFixed(0)}%`
    if (updateState.kind === 'ready') return 'Restart to update'
    return ''
  }, [updateState])

  return (
    <div
      className="dsfc-titlebar bg-bg-800 border-b border-border flex items-center overflow-hidden"
      style={{ height: TITLEBAR_HEIGHT, WebkitAppRegion: 'drag' as any }}
    >
      {/* macOS traffic lights live in the native titlebar; reserve space so UI never overlaps. */}
      <div className="dsfc-traffic-inset" style={{ width: insetX, flex: `0 0 ${insetX}px` }} />

      <div className="px-3 flex items-center gap-2 min-w-0">
        <img
          src={dfscLogo}
          alt="DFSC"
          title={props.version ? `v${props.version}` : undefined}
          className="h-5 w-auto dsfc-no-drag"
          draggable={false}
          style={{ WebkitAppRegion: 'no-drag' as any }}
        />
        <div
          className="text-sm font-semibold text-text-100 dsfc-no-drag truncate whitespace-nowrap"
          style={{ WebkitAppRegion: 'no-drag' as any }}
        >
          {props.title ?? APP_DISPLAY_NAME}
        </div>
      </div>

      <div className="flex-1" />

      {/* Reserve space so layout never shifts when hidden */}
      <div className="mr-2 w-8 h-8 flex items-center justify-center" style={{ WebkitAppRegion: 'no-drag' as any }}>
        {updateState.kind !== 'hidden' ? (
          <button
            title={updateTooltip}
            className={
              'dsfc-no-drag w-8 h-8 rounded-md flex items-center justify-center transition-colors ' +
              (updateState.kind === 'available'
                ? 'text-accent hover:brightness-110 animate-pulse drop-shadow-[0_0_10px_rgba(245,158,11,0.35)]'
                : updateState.kind === 'downloading'
                  ? 'text-accent'
                  : 'text-accent hover:brightness-110')
            }
            style={{ WebkitAppRegion: 'no-drag' as any }}
            onClick={() => {
              const api: any = (window as any).dfsc
              const updates = api?.updates
              if (!updates) return

              if (updateState.kind === 'available') {
                void updates.downloadLive?.()
                setUpdateState({ kind: 'downloading', percent: 0 })
              } else if (updateState.kind === 'ready') {
                void updates.installLive?.()
              }
            }}
          >
            {updateState.kind === 'available' ? (
              <DownloadIcon />
            ) : updateState.kind === 'downloading' ? (
              <span className="text-[11px] tabular-nums">{updateState.percent.toFixed(0)}%</span>
            ) : (
              <RestartIcon />
            )}
          </button>
        ) : null}
      </div>

      {props.offline ? (
        <div
          className="dsfc-no-drag mr-3 px-2 py-1 rounded-md border border-highlight/30 bg-highlight/10 text-highlight text-[11px]"
          style={{ WebkitAppRegion: 'no-drag' as any }}
        >
          Offline
        </div>
      ) : null}
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

function RestartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}
