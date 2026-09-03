import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { FACE_MOTION, MOTIONLESS, faceLabel, isMotionless, liveActivityOf, teammateActivity } from './faceState.js'
import type { FaceActivity } from './faceState.js'

const ALL: readonly FaceActivity[] = ['thinking', 'working', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']

let sequence = 0
function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${String(sequence)}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: '2026-09-03T10:00:00.000Z',
    sourceAdapter: 'codex',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

describe('which states move', () => {
  it('idle and blocked are the only motionless states, and every other state moves', () => {
    for (const activity of ALL) {
      expect(isMotionless(activity), activity).toBe(MOTIONLESS.includes(activity))
    }
  })

  it('names every animation for the state it means, and retires the generic one', () => {
    const names = Object.values(FACE_MOTION).flatMap((motion) => [motion.chip, motion.eyes, motion.mouth]).filter((v): v is string => v !== undefined)
    expect(names.some((name) => /^lcEyes /.test(name))).toBe(false)
    expect(FACE_MOTION.thinking.eyes).toMatch(/^lcEyesUp/)
    expect(FACE_MOTION.working.eyes).toMatch(/^lcEyesDown/)
    expect(FACE_MOTION.responding.eyes).toMatch(/^lcEyesFwd/)
    expect(FACE_MOTION.receiving.eyes).toMatch(/^lcGlance/)
  })

  it('done hops once; it is not a loop', () => {
    expect(FACE_MOTION.done.chip).toMatch(/ 1$/)
  })

  it('thinking is not still: a still face is idle, and a reasoning teammate is not abandoned', () => {
    expect(isMotionless('thinking')).toBe(false)
  })

  it('has a word for every state', () => {
    for (const activity of ALL) expect(faceLabel(activity).length).toBeGreaterThan(0)
    expect(faceLabel('waiting')).toBe('waiting on you')
    expect(faceLabel('responding')).toBe('replying')
  })
})

describe('what a live run is doing', () => {
  it('is idle when not running, whatever the events say', () => {
    expect(liveActivityOf([event('tool.started', { itemId: 't', toolKind: 'x', name: 'x', phase: 'started' })], false)).toBe('idle')
  })

  it('thinks during an open reasoning step', () => {
    expect(liveActivityOf([event('step.started', { stepKind: 'reasoning', itemType: 'r' })], true)).toBe('thinking')
  })

  it('works during an open tool, even one begun mid-reasoning', () => {
    expect(
      liveActivityOf(
        [
          event('step.started', { stepKind: 'reasoning', itemType: 'r' }),
          event('tool.started', { itemId: 't1', toolKind: 'command_execution', name: 'shell', phase: 'started' })
        ],
        true
      )
    ).toBe('working')
  })

  it('replies while a message is still streaming, and stops when it is final', () => {
    const streaming = [event('message.delta', { itemId: 'm', operation: 'append', text: 'Hel', final: false })]
    expect(liveActivityOf(streaming, true)).toBe('responding')
    const done = [...streaming, event('message.delta', { itemId: 'm', operation: 'append', text: 'lo', final: true })]
    expect(liveActivityOf(done, true)).toBe('working')
  })

  it('is never idle while the run is live, even between steps', () => {
    expect(liveActivityOf([], true)).not.toBe('idle')
  })
})

describe('one teammate, one state', () => {
  const base = { blocked: false, waitingOnYou: false, live: 'idle' as const, recentlyDone: false, recentlyReceived: false }

  it('blocked outranks everything', () => {
    expect(teammateActivity({ ...base, blocked: true, waitingOnYou: true, live: 'working' })).toBe('blocked')
  })

  it('waiting on you never resolves to still, and outranks live work', () => {
    const state = teammateActivity({ ...base, waitingOnYou: true, live: 'working' })
    expect(state).toBe('waiting')
    expect(isMotionless(state)).toBe(false)
  })

  it('follows the live run when there is one', () => {
    expect(teammateActivity({ ...base, live: 'thinking' })).toBe('thinking')
    expect(teammateActivity({ ...base, live: 'responding' })).toBe('responding')
  })

  it('hops once when a mission just finished, then glances at a message that just arrived, then rests', () => {
    expect(teammateActivity({ ...base, recentlyDone: true, recentlyReceived: true })).toBe('done')
    expect(teammateActivity({ ...base, recentlyReceived: true })).toBe('receiving')
    expect(teammateActivity(base)).toBe('idle')
  })
})
