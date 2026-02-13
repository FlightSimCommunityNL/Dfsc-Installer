import React from 'react'
import dfscLogo from '../assets/dfsc-logo.png'
import { MACOS_TRAFFIC_INSET_X, TITLEBAR_HEIGHT } from '@shared/windowChrome'

export function TitleBar(props: { title?: string; offline?: boolean }) {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const insetX = isMac ? MACOS_TRAFFIC_INSET_X : 0

  return (
    <div
      className="dsfc-titlebar bg-bg-800 border-b border-border flex items-center overflow-hidden"
      style={{ height: TITLEBAR_HEIGHT }}
    >
      {/* macOS traffic lights live in the native titlebar; reserve space so UI never overlaps. */}
      <div className="dsfc-traffic-inset" style={{ width: insetX, flex: `0 0 ${insetX}px` }} />

      <div className="px-3 flex items-center gap-2 min-w-0">
        <img src={dfscLogo} alt="DFSC" className="h-5 w-auto dsfc-no-drag" draggable={false} />
        <div className="text-sm font-semibold text-text-100 dsfc-no-drag truncate">
          {props.title ?? 'Dfsc Installer'}
        </div>
      </div>

      <div className="flex-1" />

      {props.offline ? (
        <div className="dsfc-no-drag mr-3 px-2 py-1 rounded-md border border-highlight/30 bg-highlight/10 text-highlight text-[11px]">
          Offline
        </div>
      ) : null}
    </div>
  )
}
