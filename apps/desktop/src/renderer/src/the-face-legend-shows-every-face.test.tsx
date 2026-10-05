import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FACE_LEGEND, FaceLegend, legendName, legendPresence } from './components/FaceLegend.js'
import { eyeGlyphsFor, flashFor, moodFor } from './components/TeammateBot.js'
import { faceLabel } from './faceState.js'
import type { FaceActivity } from './faceState.js'
import { facePresenceFor } from './status.js'

/**
 * WHAT A FACE SAYS, IN TURN (2026-10-05, Settings > Appearance).
 *
 * Colin: "we want the user to be able to see how much versatility the eyes
 * have, we dont want them locked behind tool calls the user may never use";
 * and of the legend, "if its clean and production ready we can just ship it".
 * One teammate goes through every face a teammate has, each named under it.
 * Its resting (behind other windows, untouched, reduced motion) is the cover's
 * own rule, useCoverActivity, held by the-home-cover-rests-after-inactivity;
 * drive-face-legend.mjs watches it do so in the app.
 */
const ALL: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']

describe('the face legend', () => {
  it('shows every face a teammate has, each once: a subagent at work wears the work face, so it is shown as that', () => {
    const shown = FACE_LEGEND.map((step) => step.activity)
    expect(new Set(shown).size).toBe(shown.length)
    const faces = (activity: FaceActivity): string => JSON.stringify([eyeGlyphsFor(activity), moodFor(activity), flashFor(activity), legendPresence(activity)])
    for (const activity of ALL) expect(shown.some((one) => faces(one) === faces(activity)), activity).toBe(true)
    expect(shown).not.toContain('delegating')
  })

  it('names each in the words the app says beside a face, in sentence case', () => {
    for (const { activity } of FACE_LEGEND) {
      expect(legendName(activity).toLowerCase()).toBe(faceLabel(activity))
      expect(legendName(activity)[0]).toBe(legendName(activity)[0]?.toUpperCase())
    }
    expect(FACE_LEGEND.map((step) => legendName(step.activity))).toEqual(['Idle', 'Thinking', 'Working', 'Replying', 'Done', 'Waiting on you', 'Listening', 'Blocked'])
  })

  it("gives each face the dot a teammate's has for it", () => {
    const status = { thinking: 'working', working: 'working', responding: 'working', waiting: 'approval-needed', blocked: 'blocked', done: 'idle', receiving: 'idle', idle: 'idle' } as const
    for (const { activity } of FACE_LEGEND) expect(legendPresence(activity), activity).toBe(facePresenceFor(status[activity as keyof typeof status]))
  })

  it('holds each long enough to be read, the whole round under half a minute', () => {
    for (const { seconds } of FACE_LEGEND) {
      expect(seconds).toBeGreaterThanOrEqual(2)
      expect(seconds).toBeLessThanOrEqual(4)
    }
    expect(FACE_LEGEND.reduce((sum, step) => sum + step.seconds, 0)).toBeLessThan(30)
  })

  it('is a button that says which face it shows, the face under it a real teammate face', () => {
    const html = renderToStaticMarkup(<FaceLegend />)
    expect(html).toMatch(/^<button type="button" class="lc-facelegend"/)
    expect(html).toContain('data-face-legend="idle"')
    expect(html).toContain('aria-label="A teammate&#x27;s face: Idle. Show the next one."')
    expect(html).toContain('class="lc-face lc-bot')
    expect(html).toContain('data-bot="droid"')
    expect(html).toContain('>Idle</span>')
  })
})
