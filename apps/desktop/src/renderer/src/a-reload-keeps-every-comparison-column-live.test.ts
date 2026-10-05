import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { CodexMissionUpdate, PublicRecoveredMission } from '../../shared/ipc.js'
import { recoverLiveRuns } from './recoverLiveRuns.js'

const mission = (id: string, phase: PublicRecoveredMission['phase'] = 'interrupted'): PublicRecoveredMission => ({
  missionId: id, runId: `run-${id}`, workspaceId: 'workspace', prompt: 'Write hello.md.', runtime: 'opencode',
  model: 'opencode/nemotron-3-ultra-free', requestedRouteId: 'opencode', resolvedRouteId: 'opencode', cliVersion: '1.18.27',
  createdAt: '2026-10-05T17:22:29.756Z', lastUpdatedAt: '2026-10-05T17:22:46.387Z', phase,
  events: [], eventCount: 0, eventsTruncated: false, sandbox: 'full-access', integrityIssueCount: 0, checkpoints: [], peerMessages: []
})
const restore = (m: PublicRecoveredMission) => ({ phase: m.phase as string, restored: true, restoredMission: m, error: 'No terminal receipt', events: m.events })
const noUpdate = (run: ReturnType<typeof restore>) => run

describe('a reload with comparison columns still running', () => {
  it('restores both silent host-owned columns as running without an interrupted error', () => {
    const a = mission('a'), b = mission('b')
    const result = recoverLiveRuns(new Map(), [a, b], ['a', 'b'], new Map(), restore, noUpdate)
    expect([...result.keys()]).toEqual(['run-a', 'run-b'])
    for (const run of result.values()) {
      expect(run.phase).toBe('running')
      expect(run.restored).toBe(false)
      expect(run.error).toBeUndefined()
      expect(run.restoredMission).toBeUndefined()
    }
  })

  it('leaves a genuinely interrupted record alone when the host owns no process', () => {
    const held = new Map<string, ReturnType<typeof restore>>()
    expect(recoverLiveRuns(held, [mission('a')], [], new Map(), restore, noUpdate)).toBe(held)
  })

  it('keeps an already-held terminal receipt ahead of an older live history answer', () => {
    const done = { ...restore(mission('a', 'completed')), restored: false }
    const held = new Map([['run-a', done]])
    expect(recoverLiveRuns(held, [mission('a')], ['a'], new Map(), restore, noUpdate)).toBe(held)
    expect(held.get('run-a')?.phase).toBe('completed')
  })

  it('replays the recorded completion that arrived before history named its run', () => {
    // The actual normalized terminal receipt from sol-4; ids and paths scrubbed.
    const event = JSON.parse(readFileSync(new URL('../../../test/fixtures/compare-column-completed.json', import.meta.url), 'utf8')) as Extract<CodexMissionUpdate, {kind: 'event'}>['event']
    const update: CodexMissionUpdate = { kind: 'event', runId: 'run-a', missionId: 'a', event }
    const apply = vi.fn((run: ReturnType<typeof restore>, _update: CodexMissionUpdate) => ({ ...run, phase: 'completed', events: [event] }))
    const pending = new Map([['run-a', [update]]])
    const result = recoverLiveRuns(new Map(), [mission('a')], [], pending, restore, apply)
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ restored: true }), update)
    expect(result.get('run-a')?.phase).toBe('completed')
    expect(result.get('run-a')?.events[0]?.payload).toMatchObject({ process: { exitCode: 0 } })
    // React's second evaluation gets the same queue; only a committed run clears it.
    expect(recoverLiveRuns(new Map(), [mission('a')], [], pending, restore, apply)).toEqual(result)
    expect(pending.get('run-a')).toEqual([update])
  })

  it('replays every queued update in order without replacing a completed ledger phase with running', () => {
    const apply = vi.fn((run: ReturnType<typeof restore>, _update: number) => run)
    const result = recoverLiveRuns(new Map(), [mission('a', 'completed')], ['a'], new Map([['run-a', [1, 2]]]), restore, apply)
    expect(apply.mock.calls.map(call => call[1])).toEqual([1, 2])
    expect(result.get('run-a')?.phase).toBe('completed')
  })

  it('connects every history read and late known-run update to reload recovery', () => {
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('setRuns((current) => recoverLiveRuns(')
    expect(app).toContain('response.data.liveMissionIds ?? []')
    expect(app).toContain('current, response.data.missions, response.data.liveMissionIds ?? [], pendingUpdatesRef.current,')
    expect(app).toContain('historyRef.current.find((mission) => mission.runId === update.runId)')
    expect(app).toContain('[...queued, update].reduce(applyMissionUpdate, reopenedRun(recorded, historyByIdRef.current))')
    expect(app).toContain('for (const runId of runs.keys()) pendingUpdatesRef.current.delete(runId)')
  })
})
