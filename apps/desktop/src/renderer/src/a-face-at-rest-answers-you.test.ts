import { describe, expect, it } from 'vitest'

import { IDLE_MOMENTS, LISTEN_HOLD_MS, MOMENT_EVERY, momentFor, seeded } from './faceLife.js'
import type { IdleMoment } from './faceLife.js'
import type { FaceActivity } from './faceState.js'
import { NOTICE_DWELL_MS, PRESENCE_MIN, everydayFace, eyeGlyphsFor, flashFor, moodFor } from './components/TeammateBot.js'
import { BOT_SIZE } from './botSizes.js'

/**
 * A FACE AT REST ANSWERS YOU (2026-10-05).
 *
 * Colin, of the screen faces' eyes: "we want the user to be able to see how
 * much versatility the eyes have, we dont want them locked behind tool calls
 * the user may never use, while also still being responsive to whatever is
 * currently happening in the session ... we want it to feel responsive but
 * not only certain animations locked behind rare events, except for the green
 * finish color change". A teammate at rest was two still bars, whatever you
 * did. Now it answers you -- glad when you point at it, listening as you type
 * to it -- and now and then has a moment of its own, each a face it already
 * has. What it is doing always comes first, and the green stays the finish's.
 */

const ALL: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
const none = { noticed: false, listening: false, moment: undefined }
const look = IDLE_MOMENTS.find((moment) => moment.name === 'look') as IdleMoment

describe('a face at rest', () => {
  it('says what it is doing, whatever else is going on: busy, stuck, waiting or done, a pointer only turns its head', () => {
    for (const activity of ALL.filter((one) => one !== 'idle')) {
      for (const life of [none, { noticed: true, listening: true, moment: look }]) {
        const face = everydayFace(activity, life)
        expect(face.eyes, activity).toEqual(eyeGlyphsFor(activity))
        expect(face.mood, activity).toBe(moodFor(activity))
        expect(face.key, activity).toBe(activity)
      }
      // Pointed at, it wakes to look at you, even where it would keep still (stuck).
      expect(everydayFace(activity, { ...none, noticed: true }).lively).toBe(true)
    }
  })

  it('answers you first: pointed at, it is glad; typed to, it listens; otherwise a moment of its own, or its bars', () => {
    expect(everydayFace('idle', { noticed: true, listening: true, moment: look })).toMatchObject({ eyes: ['^', '^'], mood: 'glad', key: 'idle:noticed', lively: true })
    expect(everydayFace('idle', { noticed: false, listening: true, moment: look })).toMatchObject({ eyes: ['o', 'o'], mood: 'perked', key: 'idle:listening', lively: true })
    expect(everydayFace('idle', { ...none, moment: look })).toMatchObject({ eyes: ['o', 'o'], key: 'idle:look', lively: true, glance: look.glance })
    expect(everydayFace('idle', none)).toEqual({ eyes: undefined, mood: undefined, key: 'idle', lively: false })
  })

  it('never flashes green for any of it: the green is the finish\'s alone', () => {
    // The flash belongs to what a teammate is doing, never to its everyday life.
    for (const activity of ALL) expect(flashFor(activity), activity).toBe(activity === 'done' ? 'green' : undefined)
  })

  it('shows, in its moments, only faces that do not say it is busy or stuck', () => {
    const busy = new Set(['••', '>▮', '><'])
    for (const moment of IDLE_MOMENTS) {
      expect(busy.has(moment.eyes.join('')), moment.name).toBe(false)
      expect(moment.seconds).toBeGreaterThan(0.5)
      expect(moment.seconds).toBeLessThan(3)
    }
    // Between them, every other face it has: eyes wide, glad, curious, asleep.
    expect(new Set(IDLE_MOMENTS.map((moment) => moment.eyes.join('')))).toEqual(new Set(['oo', '^^', 'cc']))
    expect(IDLE_MOMENTS.some((moment) => moment.mood === 'curious')).toBe(true)
  })

  it('never has the same moment twice running, looks to either side, and each face makes its own choices', () => {
    for (const seed of [0.05, 0.31, 0.62, 0.97]) {
      let last: IdleMoment['name'] | undefined
      const sides = new Set<number>()
      const names = new Set<string>()
      for (let count = 0; count < 60; count += 1) {
        const moment = momentFor(seed, count, last)
        expect(moment.name).not.toBe(last)
        // The same face, the same count: the same moment.
        expect(momentFor(seed, count, last)).toEqual(moment)
        if (moment.glance !== undefined) sides.add(moment.glance.x)
        names.add(moment.name)
        last = moment.name
      }
      expect(sides).toEqual(new Set([-1, 1]))
      expect(names.size).toBe(IDLE_MOMENTS.length)
    }
    // Two faces side by side do not keep time with each other.
    const first = (seed: number): readonly number[] => Array.from({ length: 8 }, (_, count) => seeded(seed, count))
    expect(first(0.2)).not.toEqual(first(0.21))
    for (const value of first(0.2)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('has its moments now and then, the face you talk to more often than the rest, never a show', () => {
    const [least, most] = MOMENT_EVERY.full
    expect(least).toBeGreaterThanOrEqual(5)
    expect(most).toBeGreaterThan(least)
    expect(MOMENT_EVERY.subtle[0]).toBeGreaterThan(most)
    // Longer between them than the longest of them: most of the time a face at rest is at rest.
    expect(least).toBeGreaterThan(2 * Math.max(...IDLE_MOMENTS.map((moment) => moment.seconds)))
  })

  it('is a presence, not a mark beside a name: the sizes that answer you are the teammate itself (botSizes.ts)', () => {
    for (const presence of [BOT_SIZE.threadLive, BOT_SIZE.workroomHeader, BOT_SIZE.rosterCard, BOT_SIZE.sidebarFaces, BOT_SIZE.railRow]) expect(presence).toBeGreaterThanOrEqual(PRESENCE_MIN)
    for (const mark of [BOT_SIZE.pickerMark, BOT_SIZE.tileMark, BOT_SIZE.conversationOwner, BOT_SIZE.memoryAuthor]) expect(mark).toBeLessThan(PRESENCE_MIN)
    // A pointer passing over a list is not a visit; listening outlasts a pause between words.
    expect(NOTICE_DWELL_MS).toBeGreaterThanOrEqual(150)
    expect(LISTEN_HOLD_MS).toBeGreaterThanOrEqual(2_000)
  })
})
