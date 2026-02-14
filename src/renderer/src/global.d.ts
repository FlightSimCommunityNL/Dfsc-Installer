import type { DfscApi } from '../../preload/index'

declare global {
  interface Window {
    dfsc: DfscApi
  }
}

export {}
