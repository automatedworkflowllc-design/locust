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
    // Once the message is final the run is live with nothing open, which is
    // waiting rather than replying. It answered `working` until 2026-09-05;
    // see below for why that changed.
    const done = [...streaming, event('message.delta', { itemId: 'm', operation: 'append', text: 'lo', final: true })]
    expect(liveActivityOf(done, true)).toBe('thinking')
  })

  it('is never idle while the run is live, even between steps', () => {
    expect(liveActivityOf([], true)).not.toBe('idle')
  })

  it('calls a live run with nothing open thinking, not working', () => {
    // The app has no evidence of WORK between steps -- no tool, no message,
    // no reported reasoning -- only evidence of waiting. Calling it `working`
    // put a bobbing face beside the staggered dots the waiting line now
    // shows, which the avatar spec forbids because they say opposite things.
    // Caught by `_smoke/avatar-smoke.mjs`, which is why that smoke exists.
    expect(liveActivityOf([], true)).toBe('thinking')
    const settled = [
      event('step.started', { stepKind: 'turn', message: 'Working' }),
      event('step.completed', { stepKind: 'turn' })
    ]
    expect(liveActivityOf(settled, true)).toBe('thinking')
  })

  it('calls a named turn step working, because its line shows no dots', () => {
    // The other half of the same rule: the face and the dots must agree in
    // BOTH directions. A named step draws a line without dots, so a thinking
    // face there would contradict it just as a working face contradicts the
    // waiting line's dots.
    const named = [event('step.started', { stepKind: 'turn', message: 'Running the billing suite' })]
    expect(liveActivityOf(named, true)).toBe('working')
  })

  it('still calls an open tool working', () => {
    // The change above must not swallow the state that means something IS
    // happening: a tool running is work, and its face bobs.
    const open = [event('tool.started', { itemId: 't', toolKind: 'x', name: 'x', phase: 'started' })]
    expect(liveActivityOf(open, true)).toBe('working')
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

describe('a run waiting on its own subagent', () => {
  const at = '2026-09-05T00:00:00.000Z'
  const base = { runId: 'run_1', sequence: 1, occurredAt: at, sourceAdapter: 'claude' as const }
  const started = (name: string, itemId: string) => ({ ...base, id: `s-${itemId}`, type: 'tool.started', payload: { itemId, toolKind: 'tool', name, phase: 'started', evidence: { redacted: true } } }) as never
  const done = (name: string, itemId: string) => ({ ...base, id: `d-${itemId}`, type: 'tool.completed', payload: { itemId, toolKind: 'tool', name, phase: 'completed', evidence: { redacted: true } } }) as never

  it('reads "subagent working" while an Agent or Task call is open, and working again once it reports back', () => {
    expect(liveActivityOf([started('Read', 'r1'), done('Read', 'r1'), started('Agent', 'a1')], true)).toBe('delegating')
    expect(faceLabel('delegating')).toBe('subagent working')
    expect(liveActivityOf([started('Agent', 'a1'), done('Agent', 'a1'), started('Read', 'r2')], true)).toBe('working')
    expect(liveActivityOf([started('task', 't1')], true)).toBe('delegating')
  })
})

/*
 * M23 (the code review): Claude Code restates a tool's start once its input
 * arrives -- a second tool.started for the same item -- and every start was
 * counted. A finished Agent call left the face on "subagent working" for the
 * rest of the run, beside a live line that had already closed it.
 */
describe('a tool whose start is said twice', () => {
  const started = (itemId: string, name: string, command?: string) =>
    event('tool.started', { itemId, toolKind: 'tool', name, ...(command === undefined ? {} : { command }) })
  const completed = (itemId: string, name: string) => event('tool.completed', { itemId, toolKind: 'tool', name })

  it('is closed by its one completion', () => {
    const agent = [started('toolu_1', 'Agent'), started('toolu_1', 'Agent', 'Survey the tests'), completed('toolu_1', 'Agent')]
    expect(liveActivityOf(agent, true)).toBe('thinking')
    const read = [started('toolu_2', 'Read'), started('toolu_2', 'Read', 'src/app.ts'), completed('toolu_2', 'Read')]
    expect(liveActivityOf(read, true)).toBe('thinking')
  })

  it('is still open until then', () => {
    expect(liveActivityOf([started('toolu_1', 'Agent'), started('toolu_1', 'Agent', 'Survey the tests')], true)).toBe('delegating')
    expect(liveActivityOf([started('toolu_2', 'Bash'), started('toolu_2', 'Bash', 'ls')], true)).toBe('working')
  })
})
