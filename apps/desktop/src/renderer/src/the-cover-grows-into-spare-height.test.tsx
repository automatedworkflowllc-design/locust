import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { COVER_HEIGHT, COVER_MACHINE, COVER_MAX_GROW, COVER_MIN_GROW, COVER_WIDTH, HomeCover, coverGrowFor } from './components/HomeCover.js'

/*
 * Colin, 2026-09-26, on Home at a large window: "theres lots of dead space,
 * might need to make logo bigger". The drawing grows into spare height, about
 * its own centre, and never moves the card the composer's column shares.
 */
describe('how much the cover grows', () => {
  const base = COVER_HEIGHT * (760 / COVER_WIDTH)

  it('not at all with exactly the room it needs, or none measured', () => {
    expect(coverGrowFor(0, base)).toBe(1)
    expect(coverGrowFor(Number.NaN, base)).toBe(1)
  }, 10_000)

  /*
   * 0.401: a new person's Home at 1440x900 was 66px short, the pane keeps to
   * its end, and the mascots stood cut off by the title bar. Short of room,
   * the drawing gives height back -- but never below the claim's floor, where
   * the 10.5px claim still fits its glass (drive-signed-out measures 21px).
   */
  it('shrinks by what the page is short, down to 0.85x and no further', () => {
    expect(COVER_MIN_GROW).toBe(0.85)
    expect(coverGrowFor(-base * 0.1, base)).toBe(0.9)
    expect(coverGrowFor(-120, base)).toBe(0.85)
    expect(coverGrowFor(-base * 10, base)).toBe(0.85)
  }, 10_000)

  it('by the room it is given, relative to its own height', () => {
    expect(coverGrowFor(base * 0.2, base)).toBe(1.2)
  }, 10_000)

  it('at most 1.45x, however much room there is', () => {
    expect(COVER_MAX_GROW).toBe(1.45)
    expect(coverGrowFor(base * 10, base)).toBe(1.45)
  }, 10_000)
})

describe('the grown drawing', () => {
  // Server-rendered, the card has not been measured: the cover draws at the
  // narrowest column, 760px, which is what these positions are checked against.
  const cardWidth = 760
  const machineLeft = (grow: number): { left: number; width: number } => {
    const html = renderToStaticMarkup(<HomeCover ready={false} tube="full" grow={grow} />)
    const style = /lc-cover__machineslot" style="left:(-?\d+)px;top:-?\d+px;width:(\d+)px/.exec(html)
    expect(style).not.toBeNull()
    return { left: Number(style![1]), width: Number(style![2]) }
  }

  it('stays centred on its card, at its own size and grown', () => {
    for (const grow of [1, 1.2, COVER_MAX_GROW]) {
      const { left, width } = machineLeft(grow)
      expect(Math.abs(left - (cardWidth - width) / 2)).toBeLessThanOrEqual(1)
    }
  }, 10_000)

  it('draws smaller when the page gives less than it needs, and no smaller than the floor', () => {
    const own = machineLeft(1)
    const short = machineLeft(0.5)
    expect(short.width).toBe(Math.round(own.width * COVER_MIN_GROW))
    expect(Math.abs(short.left - (cardWidth - short.width) / 2)).toBeLessThanOrEqual(1)
  })

  it('keeps clear of the card edges at its largest', () => {
    const { left, width } = machineLeft(COVER_MAX_GROW)
    expect(left).toBeGreaterThan(0)
    expect(left + width).toBeLessThan(cardWidth)
    expect(width).toBeGreaterThan(COVER_MACHINE.width * (cardWidth / COVER_WIDTH))
  }, 10_000)
})
