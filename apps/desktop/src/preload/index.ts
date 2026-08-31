import { contextBridge, ipcRenderer } from 'electron'

export type LocalRuntimeId = 'codex' | 'claude' | 'omniroute'
export type RuntimeAuthState = 'authenticated' | 'unauthenticated' | 'unknown' | 'not-applicable'
export type RuntimeProbeStatus = 'ready' | 'not-installed' | 'auth-required' | 'offline' | 'probe-failed'

export interface PublicRuntimeStatus {
  readonly id: LocalRuntimeId
  readonly displayName: string
  readonly installed: boolean
  readonly version: string | null
  readonly auth: RuntimeAuthState
  readonly ready: boolean
  readonly status: RuntimeProbeStatus
}

export type RuntimeDiscoveryResponse =
  | {
      readonly ok: true
      readonly data: {
        readonly checkedAt: string
        readonly runtimes: readonly PublicRuntimeStatus[]
      }
    }
  | {
      readonly ok: false
      readonly error: {
        readonly code: 'DISCOVERY_FAILED'
        readonly message: string
      }
    }

export interface DesktopApi {
  platform: NodeJS.Platform
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  getLocalRuntimes: () => Promise<RuntimeDiscoveryResponse>
}

const desktopApi: DesktopApi = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  getLocalRuntimes: () => ipcRenderer.invoke('runtime-discovery:get') as Promise<RuntimeDiscoveryResponse>
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
