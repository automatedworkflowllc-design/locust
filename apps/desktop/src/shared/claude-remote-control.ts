export const REMOTE_CONTROL_GET_CHANNEL = 'claude-remote-control:get'
export const REMOTE_CONTROL_SET_CHANNEL = 'claude-remote-control:set'
export const REMOTE_CONTROL_LABEL = 'Let me start sessions on this computer from claude.ai'
export interface RemoteControlState {
  readonly enabled: boolean
  readonly phase: 'off' | 'starting' | 'running' | 'stopping' | 'ended' | 'needs-person' | 'error'
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
  readonly truncated: boolean
  readonly exitCode?: number | null
}
