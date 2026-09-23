import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { COVER_CAST, COVER_WIDTH, HomeCover, coverScale } from './components/HomeCover.js'

/**
 * THE HOME SCREEN IS THE DESIGN SYSTEM'S COVER.
 *
 * Colin, 2026-09-22, of 0.270's home screen, which had the cover's lockup and
 * nothing else: "it can be a 1:1 once you fix the text description under
 * locust tbh ... cause right now it just looks like the locust logo and crt
 * shipped". So the card carries the whole cover -- lockup, the claim under
 * it, and the three teammates on their plate -- drawn to the column's width.
 */

const activities = (html: string): string[] => [...html.matchAll(/data-activity="([a-z]+)"/g)].map((match) => match[1] ?? '')

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

  it('has the lockup and, under it, the claim', () => {
    expect(after).toContain('aria-label="Locust"')
    expect(after).toContain('<p class="lc-cover__claim">Autonomous teammates on your own machine</p>')
    // The claim sits in the same centred column as the lockup, after it.
    const brand = after.slice(after.indexOf('lc-cover__brand'))
    expect(brand.indexOf('lc-lockup')).toBeLessThan(brand.indexOf('lc-cover__claim'))
  })

  it('has the three teammates on their plate, in the cover order', () => {
    expect(after).toContain('class="lc-cover__plate" aria-hidden="true"')
    expect(COVER_CAST.map((face) => face.key)).toEqual(['wren', 'atlas', 'sable'])
    expect(activities(after)).toEqual(['working', 'waiting', 'idle'])
  })

  it('wakes the teammates with the lockup: still and dotless until the runtimes answer', () => {
    expect(activities(before)).toEqual(['idle', 'idle', 'idle'])
    expect(before).not.toContain('lc-presence')
    expect(before).not.toContain('lc-face__ring')
    // Then Wren works, Atlas waits on you, and Sable stays idle.
    expect(after).toContain('lc-presence--lime')
    expect(after).toContain('lc-presence--amber')
    expect(after).toContain('lc-face__ring')
  })

  it('places each face on the cover grid at the starting scale, in whole pixels', () => {
    // Wren is 120 across at (536, 76) on the cover; at 0.792 that is 95 at (425, 60).
    expect(after).toMatch(/<span class="lc-cover__face" style="left:425px;top:60px">/)
    expect(after).toMatch(/width:95px;height:95px/)
  })

  it('is decorative apart from its words: no face answers to a name', () => {
    expect(after).not.toMatch(/lc-face[^"]*" [^>]*role="img"/)
    expect(after.match(/class="lc-face"[^>]*aria-hidden="true"/g) ?? []).toHaveLength(3)
  })
})
