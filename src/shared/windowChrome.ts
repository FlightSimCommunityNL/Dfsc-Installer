export const TITLEBAR_HEIGHT = 44

// macOS traffic lights (close/minimize/zoom) live in the native titlebar area.
// When using `titleBarStyle: 'hiddenInset'`, we reserve a safe inset region in the renderer
// so no web UI overlaps or steals clicks.
export const MACOS_TRAFFIC_INSET_X = 80
export const MACOS_TRAFFIC_INSET_Y = 14

export const MACOS_TRAFFIC_LIGHT_POS = {
  x: MACOS_TRAFFIC_INSET_Y,
  y: MACOS_TRAFFIC_INSET_Y,
} as const
