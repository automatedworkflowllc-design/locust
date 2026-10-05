import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { atWork, everydayFace, eyeGlyphsFor, phosphorFor, wornActivity } from './components/TeammateBot.js'
import { CRT_FLICK_SHARE, WORKING_BEATS, WORKING_LEAD, crtRule, workingBeatFor } from './faceLife.js'
import { liveActivityOf } from './faceState.js'
import type { FaceActivity } from './faceState.js'
import { THINK, WORKOUT, WORKOUT_STANDING, buddyMoveFor } from './petRoutines.js'

/**
 * A TEAMMATE AT WORK GOES ROUND ITS FACES (2026-10-05, faceLife.ts).
 *
 * Colin, of two teammates at work at once -- the ghost hopping with `>▮`,
 * Flash (a star on Antigravity, Gemini 3.8 Flash) holding round eyes for a
 * 24-minute turn: *"we definitely prefer the hopping and greater than symbol
 * but we can cycle through them"*; *"i really just want the user to see all
 * the different animations and versatility and make it feel alive"*. At work,
 * a face leads with `>▮` and the hop and goes round the rest; done, stuck and
 * waiting on you keep their faces, which mean something to look at.
 */

const LIVE: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding']
const ATTENTION: readonly FaceActivity[] = ['waiting', 'receiving', 'blocked', 'done', 'idle']
const life = { noticed: false, listening: false, moment: undefined }

let sequence = 0
function event(type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  sequence += 1
  return {
    id: `evt_${String(sequence)}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    occurredAt: '2026-10-05T18:51:36.000Z',
    sourceAdapter: 'antigravity',
    type,
    payload: { evidence: { redacted: false }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

describe('at work, a face leads with the prompt and the hop', () => {
  it('wears the working face whatever its run is doing this second', () => {
    for (const activity of LIVE) {
      expect(atWork(activity), activity).toBe(true)
      expect(wornActivity(activity), activity).toBe('working')
      expect(everydayFace(wornActivity(activity), life).eyes, activity).toEqual(['>', '▮'])
      expect(phosphorFor(wornActivity(activity)), activity).toBe('cyan')
    }
  })

  it('keeps the faces that mean something to look at: waiting on you, listening, stuck, done, at rest', () => {
    for (const activity of ATTENTION) {
      expect(atWork(activity), activity).toBe(false)
      expect(wornActivity(activity), activity).toBe(activity)
    }
    expect(eyeGlyphsFor(wornActivity('blocked'))).toEqual(['>', '<'])
    expect(eyeGlyphsFor(wornActivity('done'))).toEqual(['^', '^'])
    expect(phosphorFor(wornActivity('waiting'))).toBe('amber')
  })
})

describe('and goes round the rest, a beat each', () => {
  it('has a beat of each other working face, and none of the faces that mean something', () => {
    const faces = WORKING_BEATS.map((beat) => beat.eyes.join(''))
    expect(new Set(WORKING_BEATS.map((beat) => beat.name)).size).toBe(WORKING_BEATS.length)
    expect(WORKING_BEATS.length).toBeGreaterThanOrEqual(4)
    expect(faces).toContain('••')
    for (const meaning of ['^^', '><', '||', 'cc', '>▮']) expect(faces, meaning).not.toContain(meaning)
    for (const beat of WORKING_BEATS) expect(beat.state, beat.name).toBeUndefined()
  })

  it('is a beat, the prompt leading: every beat shorter than the shortest lead', () => {
    for (const level of ['full', 'subtle'] as const) {
      const [least] = WORKING_LEAD[level]
      for (const beat of WORKING_BEATS) {
        expect(beat.seconds, beat.name).toBeGreaterThanOrEqual(1.5)
        expect(beat.seconds, `${beat.name} ${level}`).toBeLessThan(least)
      }
    }
    // The face you talk to goes round sooner than one beside a name.
    expect(WORKING_LEAD.full[1]).toBeLessThan(WORKING_LEAD.subtle[1])
  })

  it('goes round all of them in turn, each face from a place of its own', () => {
    for (const seed of [0.11, 0.37, 0.62, 0.9]) {
      const round = [0, 1, 2, 3].map((count) => workingBeatFor(seed, count).name)
      expect(new Set(round).size, String(seed)).toBe(WORKING_BEATS.length)
      expect(workingBeatFor(seed, 4).name).toBe(round[0])
    }
    const starts = new Set([0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map((seed) => workingBeatFor(seed, 0).name))
    expect(starts.size).toBeGreaterThan(1)
    // Reading, it looks to one side or the other, not always the same.
    const sides = new Set(
      Array.from({ length: 40 }, (_, count) => workingBeatFor(0.37, count).glance?.x).filter((x) => x !== undefined)
    )
    expect(sides).toEqual(new Set([-1, 1]))
  })

  it('wears a beat as a change of its own, its body easing off the hop for it', () => {
    const beat = WORKING_BEATS[0]
    if (beat === undefined) throw new Error('no beats')
    const face = everydayFace('working', { ...life, beat })
    expect(face.eyes).toEqual(beat.eyes)
    expect(face.key).toBe(`working:${beat.name}`)
    expect(face.state).toBe('default')
    // Pointed at, it looks at you instead.
    expect(everydayFace('working', { ...life, noticed: true, beat }).key).toBe('working')
    // A beat is for work alone.
    expect(everydayFace('blocked', { ...life, beat }).eyes).toEqual(['>', '<'])
  })

  it('keeps Codex Buddy lifting through the beats, and thinking for the thinking one', () => {
    expect(buddyMoveFor('working:think', undefined, 'full')).toBe(THINK)
    for (const beat of WORKING_BEATS.filter((one) => one.name !== 'think')) {
      expect(buddyMoveFor(`working:${beat.name}`, undefined, 'full'), beat.name).toBe(WORKOUT)
      expect(buddyMoveFor(`working:${beat.name}`, undefined, 'subtle'), beat.name).toBe(WORKOUT_STANDING)
    }
  })
})

describe('text beside a tool is not a reply', () => {
  /** One Antigravity planner step: its reasoning, a tool call, and words delivered after the call, never final. */
  const step = (n: number, words: boolean): NormalizedRuntimeEvent[] => [
    event('step.started', { stepKind: 'reasoning' }),
    event('step.completed', { stepKind: 'reasoning' }),
    event('tool.started', { itemId: `tool_${String(n)}`, name: 'run_command', toolKind: 'run_command', phase: 'started' }),
    ...(words ? [event('message.delta', { itemId: `msg_${String(n)}`, operation: 'replace', text: 'Checking the drive next.', final: false })] : [])
  ]
  const done = (n: number): NormalizedRuntimeEvent => event('tool.completed', { itemId: `tool_${String(n)}`, phase: 'completed' })

  it('works through a tool loop whose steps carry words, never replying until its answer', () => {
    const events: NormalizedRuntimeEvent[] = [event('step.started', { stepKind: 'turn' })]
    for (let n = 0; n < 12; n += 1) {
      events.push(...step(n, n % 3 === 0))
      expect(liveActivityOf(events, true), `step ${String(n)}, its tool running`).toBe('working')
      events.push(done(n))
      expect(liveActivityOf(events, true), `step ${String(n)}, its tool done`).not.toBe('responding')
    }
    events.push(event('message.delta', { itemId: 'msg_end', operation: 'replace', text: 'Done.', final: true }))
    expect(liveActivityOf(events, true)).not.toBe('responding')
  })

  it('still replies while a reply streams with no tool open, as every other runtime does', () => {
    const events = [event('message.delta', { itemId: 'm', operation: 'append', text: 'Here is', final: false })]
    expect(liveActivityOf(events, true)).toBe('responding')
    const afterTool = [...step(1, false), done(1), event('message.delta', { itemId: 'm2', operation: 'append', text: 'So', final: false })]
    expect(liveActivityOf(afterTool, true)).toBe('responding')
  })
})

describe('the screen switches on again for the changes worth looking up for', () => {
  it('for starting work, finishing, getting stuck and waiting on you', () => {
    const rule = crtRule(0.37)
    expect(rule('idle', 'working', 1)).toBe('on')
    expect(rule('done', 'working', 1)).toBe('on')
    expect(rule('working', 'done', 2)).toBe('on')
    expect(rule('working:read', 'blocked', 2)).toBe('on')
    expect(rule('idle', 'waiting', 3)).toBe('on')
  })

  it('never for a beat going back to the lead, a moment at rest, or you pointing', () => {
    const rule = crtRule(0.37)
    for (let count = 0; count < 30; count += 1) {
      expect(rule('working:think', 'working', count)).toBeUndefined()
      expect(rule('idle', 'idle:look', count)).toBeUndefined()
      expect(rule('idle', 'idle:noticed', count)).toBeUndefined()
      expect(rule('idle:doze', 'idle', count)).toBeUndefined()
    }
  })

  it('flicks for about one beat in three, a face’s own beats, never every one', () => {
    for (const seed of [0.11, 0.37, 0.62, 0.9]) {
      const rule = crtRule(seed)
      const flicks = Array.from({ length: 300 }, (_, count) => rule('working', 'working:read', count)).filter((kind) => kind === 'flick').length
      expect(flicks / 300, String(seed)).toBeGreaterThan(CRT_FLICK_SHARE - 0.1)
      expect(flicks / 300, String(seed)).toBeLessThan(CRT_FLICK_SHARE + 0.1)
    }
    // Two faces do not flick on the same beats.
    const at = (seed: number): string => Array.from({ length: 24 }, (_, count) => (crtRule(seed)('working', 'working:focus', count) === 'flick' ? '1' : '0')).join('')
    expect(at(0.11)).not.toBe(at(0.62))
  })
})
