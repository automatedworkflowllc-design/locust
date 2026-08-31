/// <reference types="vite/client" />

import type { DesktopApi } from '../../shared/ipc.js'

declare global {
  interface Window {
    desktop?: DesktopApi
  }
}

export {}
