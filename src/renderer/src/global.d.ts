import type { DsfcApi } from '../../preload/index'

declare global {
  interface Window {
    dsfc: DsfcApi
  }
}

export {}
