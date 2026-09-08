import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '../shared/ipc.js'
import { ROUTINE_RECOVERY_CHANNEL } from '../shared/routine-recovery.js'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), expose: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }))

describe('routine recovery preload bridge', () => {
  beforeEach(() => { vi.resetModules(); mocks.expose.mockClear(); mocks.invoke.mockReset() })
  it('passes the explicit attempt, step and decision unchanged on its own channel', async () => {
    await import('./index.js')
    const bridge = mocks.expose.mock.calls[0]?.[1] as DesktopApi
    const request = { routineId: 'rt_one', attemptId: 'attempt_one', step: 2, decision: 'continue' } as const
    mocks.invoke.mockResolvedValueOnce({ ok: true })
    expect(await bridge.recoverRoutine(request)).toEqual({ ok: true })
    expect(mocks.invoke).toHaveBeenCalledWith(ROUTINE_RECOVERY_CHANNEL, request)
  })
  it('preserves main rejection and transport failure, never synthesizes acknowledgement', async () => {
    await import('./index.js')
    const bridge = mocks.expose.mock.calls[0]?.[1] as DesktopApi
    const request = { routineId: 'rt_one', attemptId: 'attempt_one', step: 2, decision: 'abandon' } as const
    mocks.invoke.mockResolvedValueOnce({ ok: false, error: { message: 'Stale decision' } })
    expect(await bridge.recoverRoutine(request)).toEqual({ ok: false, error: { message: 'Stale decision' } })
    mocks.invoke.mockRejectedValueOnce(new Error('disconnected'))
    await expect(bridge.recoverRoutine(request)).rejects.toThrow('disconnected')
  })
})
