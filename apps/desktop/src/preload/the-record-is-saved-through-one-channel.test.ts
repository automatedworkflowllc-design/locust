import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../shared/ipc.js'
import { MISSION_RECORD_SAVE_CHANNEL } from '../shared/ipc.js'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }))

describe('saving a conversation\'s record', () => {
  it('sends the turn and the tick down one channel, and gives the host\'s answer back unchanged', async () => {
    await import('./index.js')
    const bridge = mocks.expose.mock.calls[0]?.[1] as DesktopApi
    const answer = { ok: true, path: 'C:\Users\me\Downloads\Locust record - Wren - 2026-10-03.md' }
    mocks.invoke.mockResolvedValue(answer)
    expect(await bridge.saveMissionRecord({ missionId: 'mission_one', includeRaw: true })).toEqual(answer)
    expect(mocks.invoke).toHaveBeenLastCalledWith(MISSION_RECORD_SAVE_CHANNEL, { missionId: 'mission_one', includeRaw: true })
    const refused = { ok: false, message: 'That request was rejected.' }
    mocks.invoke.mockResolvedValue(refused)
    expect(await bridge.saveMissionRecord({ missionId: 'mission_one', includeRaw: false })).toEqual(refused)
  })
})
