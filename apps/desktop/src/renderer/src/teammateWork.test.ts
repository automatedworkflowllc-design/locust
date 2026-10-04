import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { RECENT_MISSION_LIMIT, agoLabel, teammateWork } from './teammateWork.js'

function usage(inputTokens: number, outputTokens: number) {
  return {
    id: 'e1',
    runId: 'run_1',
    missionId: 'mission_1',
    sequence: 1,
    type: 'run.completed',
    occurredAt: '2026-09-03T10:00:00.000Z',
    sourceAdapter: 'codex',
    payload: { usage: { inputTokens, outputTokens }, evidence: { redacted: true } }
  } as unknown as PublicRecoveredMission['events'][number]
}

function mission(
  missionId: string,
  lastUpdatedAt: string,
  overrides: Partial<PublicRecoveredMission> = {}
): PublicRecoveredMission {
  return {
    missionId,
    runId: `run_${missionId}`,
    prompt: `do ${missionId}`,
    runtime: 'codex',
    model: 'gpt',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex',
    cliVersion: null,
    createdAt: lastUpdatedAt,
    lastUpdatedAt,
    phase: 'completed',
    events: [],
    eventCount: 0,
    eventsTruncated: false,
    integrityIssueCount: 0,
    sandbox: 'read-only',
    checkpoints: [],
    peerMessages: []
  } as unknown as PublicRecoveredMission as PublicRecoveredMission & typeof overrides
}

const OWNERS = { m1: 'tm_atlas', m2: 'tm_atlas', m3: 'tm_bramble', m4: 'tm_atlas' }

describe('what a teammate has actually done', () => {
  const missions = [
    mission('m1', '2026-09-01T10:00:00.000Z'),
    mission('m2', '2026-09-03T09:00:00.000Z'),
    mission('m3', '2026-09-03T11:00:00.000Z'),
    mission('m4', '2026-09-02T10:00:00.000Z')
  ]

  it('counts only the missions the host recorded as theirs', () => {
    expect(teammateWork('tm_atlas', missions, OWNERS).missionCount).toBe(3)
    expect(teammateWork('tm_bramble', missions, OWNERS).missionCount).toBe(1)
  })

  it('takes the last run from the newest mission, not the first in the list', () => {
    expect(teammateWork('tm_atlas', missions, OWNERS).lastRunAt).toBe('2026-09-03T09:00:00.000Z')
  })

  it('lists the newest few, newest first', () => {
    const recent = teammateWork('tm_atlas', missions, OWNERS).recent
    expect(recent.map((entry) => entry.missionId)).toEqual(['m2', 'm4', 'm1'])
    expect(recent.length).toBeLessThanOrEqual(RECENT_MISSION_LIMIT)
  })

  it('says nothing about a teammate who has never run, rather than zeroes', () => {
    const work = teammateWork('tm_nobody', missions, OWNERS)
    expect(work.missionCount).toBe(0)
    expect(work.lastRunAt).toBeUndefined()
    // Undefined, not $0.00: a runtime that reported nothing has not told us
    // the work was free.
    expect(work.cost).toBeUndefined()
  })

  it('adds up what their missions reported, and only theirs', () => {
    const priced = [
      { ...mission('m1', '2026-09-01T10:00:00.000Z'), events: [usage(100, 10)] },
      { ...mission('m2', '2026-09-02T10:00:00.000Z'), events: [usage(200, 20)] },
      { ...mission('m3', '2026-09-02T11:00:00.000Z'), events: [usage(999, 99)] }
    ] as unknown as PublicRecoveredMission[]
    expect(teammateWork('tm_atlas', priced, OWNERS).cost).toEqual({ inputTokens: 300, outputTokens: 30 })
  })

  it('uses the caller’s idea of a title, so a briefing is not shown as the words a person typed', () => {
    const work = teammateWork('tm_bramble', missions, OWNERS, () => 'typed words')
    expect(work.recent[0]?.title).toBe('typed words')
  })
})

describe('how long ago that was', () => {
  const now = new Date('2026-09-03T12:00:00.000Z')

  it('reads in the largest unit that fits', () => {
    expect(agoLabel('2026-09-03T11:58:00.000Z', now)).toBe('2 minutes ago')
    expect(agoLabel('2026-09-03T09:00:00.000Z', now)).toBe('3 hours ago')
    expect(agoLabel('2026-09-01T12:00:00.000Z', now)).toBe('2 days ago')
    expect(agoLabel('2026-08-20T12:00:00.000Z', now)).toBe('2 weeks ago')
  })

  it('singularises honestly', () => {
    expect(agoLabel('2026-09-03T11:00:00.000Z', now)).toBe('1 hour ago')
    expect(agoLabel('2026-09-02T12:00:00.000Z', now)).toBe('1 day ago')
  })

  it('calls anything under a minute just now, including a clock that ran ahead', () => {
    expect(agoLabel('2026-09-03T11:59:30.000Z', now)).toBe('just now')
    expect(agoLabel('2026-09-03T12:00:30.000Z', now)).toBe('just now')
  })

  it('says nothing for a timestamp it cannot read', () => {
    expect(agoLabel('not a date', now)).toBeUndefined()
  })
})
