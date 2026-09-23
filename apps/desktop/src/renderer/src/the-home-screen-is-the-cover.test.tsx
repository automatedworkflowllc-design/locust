import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { COVER_CAST, COVER_MACHINE, COVER_WIDTH, HomeCover, coverScale } from './components/HomeCover.js'

/**
 * THE HOME SCREEN IS THE DESIGN SYSTEM'S COVER.
 *
 * Colin, 2026-09-22, of 0.270's home screen, which had the cover's lockup and
 * nothing else: "it can be a 1:1 once you fix the text description under
 * locust tbh ... cause right now it just looks like the locust logo and crt
 * shipped". So the card carries the whole cover -- lockup, the claim under
 * it, and the three teammates -- drawn to the column's width.
 *
 * AS A MACHINE (A2, 0.295). Colin: "the teammates could have a structure to
 * be on top of, the border, crt effect, would almost make it look like a
 * machine", then of the sample: "make the screen bigger and put the text in
 * it as well". The boot screen's bezel and glass, centred; the lockup and the
 * claim on the glass; the three standing on the bezel.
 */

const botAttr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`class="lc-bot[^"]*"[^>]*${name}="([a-z]+)"`, 'g'))].map((match) => match[1] ?? '')

describe('the cover, drawn to the column', () => {
  it('is the cover at the column width: 960 is its own size, 760 is 0.79 of it', () => {
    expect(coverScale(COVER_WIDTH)).toBe(1)
    expect(coverScale(760)).toBe(0.792)
    expect(coverScale(980)).toBe(1.021)
  })

  it('starts at the narrowest column before it has been measured', () => {
    expect(coverScale(0)).toBe(0.792)
    expect(coverScale(Number.NaN)).toBe(0.792)
  })
})

describe('what the home screen draws', () => {
  const before = renderToStaticMarkup(<HomeCover ready={false} tube="full" />)
  const after = renderToStaticMarkup(<HomeCover ready tube="full" />)

  it('has the lockup and, under it, the claim -- both on the machine\'s glass', () => {
    expect(after).toContain('aria-label="Locust"')
    expect(after).toContain('<p class="lc-cover__claim">Autonomous teammates on your own machine</p>')
    // Inside the glass, the lockup first and the claim after it.
    const glass = after.slice(after.indexOf('class="lc-cover__glass"'))
    expect(glass.indexOf('lc-lockup')).toBeGreaterThan(0)
    expect(glass.indexOf('lc-lockup')).toBeLessThan(glass.indexOf('lc-cover__claim'))
    // Under the tube's scanlines, like the boot screen's.
    expect(glass.indexOf('lc-cover__scan')).toBeLessThan(glass.indexOf('lc-lockup'))
  })

  it('has the three teammates on the machine, in the cover order: a ghost, a droid, a Locust', () => {
    expect(after).toContain('class="lc-cover__machine"')
    expect(after).not.toContain('lc-cover__plate')
    // They stand on its top edge: every bot's box ends near the bezel's top.
    for (const mate of COVER_CAST) expect(Math.abs(mate.y + 96 - COVER_MACHINE.y)).toBeLessThanOrEqual(12)
    expect(COVER_CAST.map((mate) => mate.key)).toEqual(['wren', 'atlas', 'sable'])
    // Colin: "lets definitely include ghost in there".
    expect(botAttr(after, 'data-bot')).toEqual(['ghost', 'droid', 'hopper'])
    expect(botAttr(after, 'data-state')).toEqual(['default', 'default', 'sleeping'])
  })

  it('has a white ghost that floats, and a green Locust', () => {
    // Colin: "maybe make the ghost white and the locust green lol", and of
    // its hops: "a little loud for a title screen, especially for a ghost".
    const ghost = COVER_CAST.find((mate) => mate.type === 'ghost')
    const locust = COVER_CAST.find((mate) => mate.type === 'hopper')
    expect(ghost?.hue).toBeUndefined()
    expect(ghost?.floats).toBe(true)
    expect(locust?.hue).toBe('lime')
    expect(after).toContain('class="lc-bot is-floating" data-bot="ghost"')
    // Nothing floats before the runtimes have answered.
    expect(before).not.toContain('is-floating')
  })

  it('wakes the teammates with the lockup: still and unmarked until the runtimes answer', () => {
    expect(botAttr(before, 'data-state')).toEqual(['still', 'still', 'still'])
    expect(before).not.toContain('lc-presence')
    expect(before).not.toContain('lc-bot__ring')
    // Then Wren floats, lit; Atlas waits on you -- Locust's amber ring and
    // dot -- and Sable sleeps, unmarked.
    expect(after).toContain('lc-presence--lime')
    expect(after).toContain('lc-presence--amber')
    expect(after.match(/lc-bot__ring/g) ?? []).toHaveLength(1)
  })

  it('places each bot on the cover grid at the starting scale, in whole pixels', () => {
    // Wren is 96 across at (245, -10) on the cover; at 0.792 that is 76 at (194, -8).
    expect(after).toMatch(/<span class="lc-cover__face" style="left:194px;top:-8px">/)
    expect(after).toMatch(/class="lc-bot is-floating" data-bot="ghost" data-state="default" style="width:76px;height:76px"/)
  })

  it('is decorative apart from its words: no bot answers to a name', () => {
    const canvases = after.match(/<canvas[^>]*>/g) ?? []
    expect(canvases).toHaveLength(3)
    expect(canvases.every((canvas) => canvas.includes('aria-hidden="true"'))).toBe(true)
  })
})
