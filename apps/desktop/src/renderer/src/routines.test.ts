import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { MAX_ROUTINE_STEPS, draftName, routineDraft, routineRunSummary, routineStepLabel } from './routines.js'

function turn(
  missionId: string,
  prompt: string,
  options: {
    readonly follows?: string
    readonly startedBy?: PublicRecoveredMission['startedBy']
  } = {}
): PublicRecoveredMission {
  return {
    missionId,
    runId: `run_${missionId}`,
    workspaceId: 'ws_test',
    prompt,
    runtime: 'cursor',
    model: 'composer-2.5',
    requestedRouteId: 'cursor',
    resolvedRouteId: 'cursor-account:default',
    cliVersion: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    lastUpdatedAt: '2026-09-05T10:00:00.000Z',
    phase: 'completed',
    events: [],
    eventCount: 0,
    eventsTruncated: false,
    integrityIssueCount: 0,
    sandbox: 'read-only',
    checkpoints: [],
    peerMessages: [],
    ...(options.startedBy === undefined ? {} : { startedBy: options.startedBy }),
    ...(options.follows === undefined
      ? {}
      : { continuesFrom: { missionId: options.follows, reason: 'follow-up' as const, checkpointEpoch: 1 } })
  } as PublicRecoveredMission
}

const index = (missions: readonly PublicRecoveredMission[]): ReadonlyMap<string, PublicRecoveredMission> =>
  new Map(missions.map((mission) => [mission.missionId, mission]))

describe('saving a conversation as a routine', () => {
  it('takes the words a person typed on each turn, in order, with where each came from', () => {
    const missions = [
      turn('m1', 'Read status.ts and summarise it.'),
      turn('m2', 'Now list every file, one per line.', { follows: 'm1' }),
      turn('m3', 'Say done.', { follows: 'm2' })
    ]
    const draft = routineDraft(missions[2]!, index(missions))
    expect(draft?.steps).toEqual(['Read status.ts and summarise it.', 'Now list every file, one per line.', 'Say done.'])
    expect(draft?.learnedFrom).toEqual(['m1', 'm2', 'm3'])
    expect(draft?.name).toBe('Read status.ts and summarise it.')
    expect(draft?.truncated).toBe(false)
  })

  it('drops turns the HOST wrote, whatever started them', () => {
    // A relayed reply, a resume and a routine step each carry a briefing
    // written for a runtime. Replaying those would replay the app's own
    // words back at itself.
    const missions = [
      turn('m1', 'Read status.ts.'),
      turn('m2', 'Booty (Custom) replied to you; it is quoted below...', {
        follows: 'm1',
        startedBy: { kind: 'relay', hop: 1 }
      }),
      turn('m3', 'Pick this back up from its last checkpoint...', {
        follows: 'm2',
        startedBy: { kind: 'resume', epoch: 2 }
      }),
      turn('m4', 'List every file.', { follows: 'm3' })
    ]
    const draft = routineDraft(missions[3]!, index(missions))
    expect(draft?.steps).toEqual(['Read status.ts.', 'List every file.'])
    expect(draft?.learnedFrom).toEqual(['m1', 'm4'])
  })

  it('has nothing to save when a person typed nothing in it', () => {
    const relayed = turn('m1', 'Wren asked you to...', { startedBy: { kind: 'relay', hop: 1 } })
    expect(routineDraft(relayed, index([relayed]))).toBeUndefined()
    const empty = turn('m1', '   ')
    expect(routineDraft(empty, index([empty]))).toBeUndefined()
  })

  it('cuts a long conversation at the limit and says it was cut', () => {
    const missions: PublicRecoveredMission[] = []
    for (let index_ = 1; index_ <= MAX_ROUTINE_STEPS + 3; index_ += 1) {
      missions.push(
        turn(`m${String(index_)}`, `step ${String(index_)}`, index_ === 1 ? {} : { follows: `m${String(index_ - 1)}` })
      )
    }
    const draft = routineDraft(missions.at(-1)!, index(missions))
    expect(draft?.steps).toHaveLength(MAX_ROUTINE_STEPS)
    expect(draft?.steps.at(-1)).toBe(`step ${String(MAX_ROUTINE_STEPS)}`)
    expect(draft?.learnedFrom).toHaveLength(MAX_ROUTINE_STEPS)
    expect(draft?.truncated).toBe(true)
  })
})

describe('how a routine reads', () => {
  it('names itself from the first step, on a word boundary, without pretending to be short', () => {
    expect(draftName('  Read   status.ts\nand summarise  ')).toBe('Read status.ts and summarise')
    const long = draftName('Read every file in this workspace and write a summary of what the project is for')
    expect(long.endsWith('...')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(63)
    expect(long).not.toContain('  ')
  })

  it('says how many steps and whether it has ever run', () => {
    expect(routineRunSummary({ steps: ['a'], runs: 0 })).toBe('1 step · not run yet')
    expect(routineRunSummary({ steps: ['a', 'b'], runs: 1 })).toBe('2 steps · run 1 time')
    expect(routineRunSummary({ steps: ['a', 'b'], runs: 4 })).toBe('2 steps · run 4 times')
  })

  it('says which step is running', () => {
    expect(routineStepLabel({ step: 2, of: 3 })).toBe('routine · step 2 of 3')
  })
})
