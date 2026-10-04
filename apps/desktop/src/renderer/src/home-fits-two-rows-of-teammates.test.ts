import { describe, expect, it } from 'vitest'

import { COVER_HEIGHT, COVER_MIN_GROW, COVER_REACH, homeIsShort } from './components/HomeCover.js'

/*
 * HOME FITS TWO ROWS OF TEAMMATES (0.583).
 *
 * Colin, 2026-10-04, at 1209x782 with six teammates: "i have to always scroll
 * up to have our home page centered, 2 rows of teammates should be enough to
 * have home page centered with no scroll bar". Measured: the pane held 658px
 * in 608, the cover already at its floor -- the room it was given counted its
 * box and not the bots' reach above it (35px) -- and it opened scrolled to the
 * END. Now the cover's footprint counts its reach, a short page tightens its
 * spacing, the column is centred, and it opens at the top. The stylesheet's
 * side is checked in src/main/home-spacing-matches-its-measure.test.ts.
 */

// Measured at 1209x782 (0.582): sections 20 + 227 + 49 + 30, five children, cover 816px wide.
const SECTIONS = 20 + 227 + 49 + 30
const FOOTPRINT = (COVER_HEIGHT + COVER_REACH) * (816 / 960)
const PANE_782 = 608

describe('home at the height Colin uses', () => {
  it('is short at its normal spacing, so it tightens', () => {
    expect(homeIsShort(SECTIONS, 5, FOOTPRINT, PANE_782)).toBe(true)
  })

  it('then fits: tight spacing saves enough with the cover at its floor', () => {
    const tight = SECTIONS + FOOTPRINT * COVER_MIN_GROW + 8 * 4 + 12 * 2
    expect(tight).toBeLessThanOrEqual(PANE_782)
  })

  it('is not short with room to spare (control), nor with nothing measured', () => {
    expect(homeIsShort(SECTIONS, 5, FOOTPRINT, 760)).toBe(false)
    expect(homeIsShort(Number.NaN, 5, FOOTPRINT, PANE_782)).toBe(false)
    expect(homeIsShort(SECTIONS, 5, FOOTPRINT, 0)).toBe(false)
  })

  it("counts the bots' reach above the cover, which the old measure left out", () => {
    // Without the reach the same page read as fitting at normal spacing, and ran 35px over.
    const boxOnly = COVER_HEIGHT * (816 / 960)
    expect(homeIsShort(SECTIONS, 5, boxOnly, 650)).toBe(false)
    expect(homeIsShort(SECTIONS, 5, FOOTPRINT, 650)).toBe(true)
  })
})
