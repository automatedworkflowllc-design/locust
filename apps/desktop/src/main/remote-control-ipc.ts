import type { IpcMainInvokeEvent } from 'electron'
import type { createRemoteControl } from './claude-remote-control.js'
import { REMOTE_CONTROL_GET_CHANNEL, REMOTE_CONTROL_SET_CHANNEL } from '../shared/claude-remote-control.js'

export function registerRemoteControlIpc(
  ipc: { handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): unknown },
  service: ReturnType<typeof createRemoteControl>,
  ownWindow: (event: IpcMainInvokeEvent) => boolean,
  refusal: () => string | undefined
): void {
  ipc.handle(REMOTE_CONTROL_GET_CHANNEL, (event) => ownWindow(event) ? service.snapshot() : undefined)
  ipc.handle(REMOTE_CONTROL_SET_CHANNEL, (event, enabled) => {
    if (!ownWindow(event) || typeof enabled !== 'boolean') return undefined
    const message = enabled ? refusal() : undefined
    if (message !== undefined) return { ...service.snapshot(), error: message }
    return service.setEnabled(enabled)
  })
}
