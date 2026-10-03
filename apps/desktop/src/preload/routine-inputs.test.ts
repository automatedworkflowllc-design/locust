import { describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../shared/ipc.js'
import { ROUTINE_RUN_CHANNEL, ROUTINE_FOLDER_CHANNEL, ROUTINE_EXPORT_CHANNEL, ROUTINE_IMPORT_PREVIEW_CHANNEL, ROUTINE_IMPORT_CHANNEL } from '../shared/ipc.js'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { invoke: mocks.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }))
describe('W7 preload bridge', () => {
  it('forwards only the declared channels and passes host responses and refusals unchanged', async () => {
    await import('./index.js')
    const bridge = mocks.expose.mock.calls[0]?.[1] as DesktopApi
    const answer = { ok: false, error: { code: 'ROUTINE_REJECTED', message: 'Missing input' } }
    mocks.invoke.mockResolvedValue(answer)
    expect(await bridge.runRoutine('rt_one', { topic: 'value' })).toEqual(answer)
    expect(mocks.invoke).toHaveBeenLastCalledWith(ROUTINE_RUN_CHANNEL, 'rt_one', { topic: 'value' })
    await bridge.chooseRoutineFolder()
    expect(mocks.invoke).toHaveBeenLastCalledWith(ROUTINE_FOLDER_CHANNEL)
    await bridge.exportRoutine({ routineId: 'rt_one', paths: 'input' })
    expect(mocks.invoke).toHaveBeenLastCalledWith(ROUTINE_EXPORT_CHANNEL, { routineId: 'rt_one', paths: 'input' })
    await bridge.previewRoutineImport()
    expect(mocks.invoke).toHaveBeenLastCalledWith(ROUTINE_IMPORT_PREVIEW_CHANNEL)
    const request = { token: 'token', teammateId: 'tm_one', route: { runtime: 'opencode', model: 'free', mode: 'ask' } } as const
    await bridge.importRoutine(request)
    expect(mocks.invoke).toHaveBeenLastCalledWith(ROUTINE_IMPORT_CHANNEL, request)
  })
})
