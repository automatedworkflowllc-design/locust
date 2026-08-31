/// <reference types="vite/client" />

interface Window {
  desktop?: {
    platform: string
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
  }
}
