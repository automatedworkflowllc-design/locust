// Colin: "Build the Settings switch and its process handling with unit tests only."
import { expect, it, vi } from 'vitest'
import { registerRemoteControlIpc } from './remote-control-ipc.js'
import { REMOTE_CONTROL_GET_CHANNEL, REMOTE_CONTROL_SET_CHANNEL } from '../shared/claude-remote-control.js'
function world(refusal?: string) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const own = {}
  const state = { enabled: false, phase: 'off', stdout: 'first', stderr: 'exact', truncated: false } as const
  const service = { snapshot: vi.fn(() => state), setEnabled: vi.fn(async () => state), dispose: vi.fn() }
  registerRemoteControlIpc({ handle: (name, handler) => { handlers.set(name, handler as never) } }, service, (event) => event === own, () => refusal)
  return { handlers, own, state, service }
}
it('Only the own window can read the verbatim output or enable the server.', async () => {
  const w = world(); const get = w.handlers.get(REMOTE_CONTROL_GET_CHANNEL)!; const set = w.handlers.get(REMOTE_CONTROL_SET_CHANNEL)!
  expect(get({})).toBeUndefined(); expect(set({}, true)).toBeUndefined(); expect(w.service.setEnabled).not.toHaveBeenCalled()
  expect(get(w.own)).toEqual(w.state); await set(w.own, true)
  expect(w.service.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
})
it('The renderer cannot send command arguments or a folder instead of a boolean.', () => {
  const w = world(); const set = w.handlers.get(REMOTE_CONTROL_SET_CHANNEL)!
  for (const input of ['true', { enabled: true, folder: 'elsewhere' }, null, 1, undefined]) expect(set(w.own, input)).toBeUndefined()
  expect(w.service.setEnabled).not.toHaveBeenCalled()
})
it('The free-only guard refuses enabling but still allows switching off.', async () => {
  const w = world('free only'); const set = w.handlers.get(REMOTE_CONTROL_SET_CHANNEL)!
  expect(set(w.own, true)).toEqual({ ...w.state, error: 'free only' }); expect(w.service.setEnabled).not.toHaveBeenCalled()
  await set(w.own, false); expect(w.service.setEnabled).toHaveBeenCalledExactlyOnceWith(false)
})
