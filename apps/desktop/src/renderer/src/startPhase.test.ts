import { describe, expect, it } from 'vitest'

import type { CodexMissionUpdate } from '../../shared/ipc.js'
import { carriedStartPhase, startingLabelOf, withStartPhase } from './startPhase.js'

/*
 * 0.602. A start-phase update arrives before the start's response, so the
 * window's run has no id yet; it is matched to the run still starting for
 * that teammate.
 */
const phase = (teammateId: string | undefined, runtime: 'codex' | 'opencode', value: 'looking' | 'briefing' | 'reading-folder' | 'starting-runtime'): CodexMissionUpdate =>
  ({ kind: 'start-phase', runtime, ...(teammateId === undefined ? {} : { teammateId }), phase: value, at: '2026-10-04T20:00:00.000Z' }) as CodexMissionUpdate

describe('the run a start-phase update belongs to', () => {
  it("is the run still starting for that teammate, and not another teammate's", () => {
    const runs = new Map([
      ['a', { phase: 'starting', runtime: 'codex', teammateId: 'tm_wren' }],
      ['b', { phase: 'starting', runtime: 'codex', teammateId: 'tm_booty' }],
      ['c', { phase: 'running', runtime: 'codex', teammateId: 'tm_wren' }]
    ])
    const next = withStartPhase(runs, phase('tm_booty', 'codex', 'briefing'))
    expect(next.get('b')).toMatchObject({ startPhase: 'briefing' })
    expect(next.get('a')).not.toHaveProperty('startPhase')
    expect(next.get('c')).not.toHaveProperty('startPhase')
  })

  it('is the one starting on that runtime when the start had no teammate', () => {
    const runs = new Map([
      ['a', { phase: 'starting', runtime: 'opencode' }],
      ['b', { phase: 'starting', runtime: 'codex' }]
    ])
    expect(withStartPhase(runs, phase(undefined, 'codex', 'reading-folder')).get('b')).toMatchObject({ startPhase: 'reading-folder' })
    expect(withStartPhase(runs, phase(undefined, 'codex', 'reading-folder')).get('a')).not.toHaveProperty('startPhase')
  })

  it('leaves the map as it was when nothing is starting, when the phase is already set, and for any other update', () => {
    const runs = new Map([['a', { phase: 'running', runtime: 'codex', teammateId: 'tm_wren' }]])
    expect(withStartPhase(runs, phase('tm_wren', 'codex', 'looking'))).toBe(runs)
    const set = new Map([['a', { phase: 'starting', runtime: 'codex', teammateId: 'tm_wren', startPhase: 'looking' as const }]])
    expect(withStartPhase(set, phase('tm_wren', 'codex', 'looking'))).toBe(set)
    expect(withStartPhase(set, { kind: 'relay-notice', runId: 'run_1', missionId: 'mission_1', message: 'x' } as unknown as CodexMissionUpdate)).toBe(set)
  })

  it("is carried onto the run the start's response makes, which otherwise knows no phase", () => {
    // The response arrives when the program is launched; the runtime may not speak for seconds more.
    expect(carriedStartPhase({ startPhase: 'starting-runtime' })).toEqual({ startPhase: 'starting-runtime' })
    expect(carriedStartPhase({})).toEqual({})
    expect(carriedStartPhase(undefined)).toEqual({})
  })

  it('words the live line per phase, in the runtime\'s own name', () => {
    // The runtime's display name, as the rest of the app says it: Codex CLI, Cursor Agent.
    expect(startingLabelOf({ startPhase: 'looking', runtime: 'codex' })).toEqual({ startingLabel: 'Looking for Codex CLI' })
    expect(startingLabelOf({ startPhase: 'briefing', runtime: 'opencode' })).toEqual({ startingLabel: 'Briefing' })
    expect(startingLabelOf({ startPhase: 'reading-folder', runtime: 'claude' })).toEqual({ startingLabel: 'Reading the folder' })
    expect(startingLabelOf({ startPhase: 'starting-runtime', runtime: 'cursor' })).toEqual({ startingLabel: 'Starting Cursor Agent' })
    expect(startingLabelOf({ runtime: 'codex' })).toEqual({})
    expect(startingLabelOf({ startPhase: 'briefing' })).toEqual({})
  })
})
