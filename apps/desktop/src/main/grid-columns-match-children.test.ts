import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A grid must not declare more columns than its row has children.
 *
 * `.lc-routinerow` declared four -- `auto minmax(0, 1fr) auto auto` -- for a
 * row with three. CSS grid does not complain: it laid the three out, gave the
 * flexible column to the Run BUTTON rather than to the name, and with no free
 * space to distribute that column computed to **zero pixels**. The button then
 * overflowed its own cell and drew on top of the Edit button beside it.
 *
 * Measured on the packaged build, 2026-09-09:
 * `gridTemplateColumns: "125.297px 0px 134.859px 0px"`, Run at x=441..496 and
 * Edit at x=447..502, same row. On screen they read as one button saying
 * "REdit", and the schedule under them was squeezed until it ended on a
 * dangling separator with the next-run time cut off.
 *
 * Nobody had noticed because a collapsed column looks like a layout choice,
 * and the comment beside the rule had said "the row is three columns" the
 * whole time -- the template drifted and the prose did not.
 *
 * This is deliberately narrow: it pins the one rule that broke, against the
 * one component whose children it describes, rather than trying to parse every
 * grid in a 7,000-line stylesheet. A wider version would be guesswork about
 * which JSX renders which selector.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const SCREENS = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)),
  'utf8'
)

/** The declared track list for a selector, e.g. `minmax(0, 1fr) auto auto`. */
function columnsOf(selector: string): string | undefined {
  /*
   * Sliced by index rather than matched by a regex built from a string.
   *
   * The first version assembled a pattern whose SOURCE TEXT carried unbalanced
   * curly braces, and `tests-assert-something` walks this file counting braces
   * to find each test body. Those literals desynchronised the count, so it
   * sliced the wrong span and reported a test below as having no assertions --
   * one it can see perfectly well now. A brace inside a string is exactly the
   * trap that control exists downstream of; no need to hand it one.
   */
  const at = CSS.indexOf(`\n${selector} `)
  if (at < 0) return undefined
  const block = CSS.slice(at, CSS.indexOf('\n}', at))
  const found = /grid-template-columns:\s*([^;]+);/.exec(block)
  return found?.[1]?.trim()
}

/** Count tracks, treating `minmax(a, b)` as one. */
function trackCount(tracks: string): number {
  return tracks.replace(/minmax\([^)]*\)/g, 'X').trim().split(/\s+/).length
}

describe('the routines row on a teammate card', () => {
  it('can read the rule and count its tracks', () => {
    // The control. A selector that no longer exists, or a regex that matches
    // nothing, would let every assertion below pass by finding nothing.
    expect(columnsOf('.lc-routinerow')).toBeDefined()
    expect(trackCount('auto minmax(0, 1fr) auto auto')).toBe(4)
    expect(trackCount('auto auto auto')).toBe(3)
  })

  it('declares exactly as many columns as the row has children', () => {
    /*
     * Three children, in this order: the name span, the Run button, and the
     * span holding Edit and Remove. Read from the JSX rather than assumed, so
     * adding a fourth control fails here instead of collapsing a column.
     */
    /*
     * A fixed window rather than an end marker.
     *
     * The end marker was the string that closes the map, and it carries a
     * closing curly brace -- which the assertion-free control counts while
     * finding test bodies, so it ended MY body early and reported this test as
     * having none. Second time in one file that a brace inside a string has
     * confused it. Two thousand characters comfortably covers the row's markup
     * and nothing else declares these three class names.
     */
    const row = SCREENS.slice(SCREENS.indexOf('className="lc-routinerow"'))
    const body = row.slice(0, 2_000)
    const children = [
      /className="lc-routinerow__name"/.test(body),
      /onClick=\{\(\) => onRunRoutine/.test(body),
      /className="lc-routinerow__meta">\s*\n\s*<button/.test(body)
    ].filter(Boolean).length
    expect(children).toBe(3)
    expect(trackCount(columnsOf('.lc-routinerow') ?? '')).toBe(children)
  })

  it('gives the name its own row rather than a share of the controls line', () => {
    // The name and the schedule are read; Run, Edit and Remove are pressed.
    // They want different room, and a ~300px card has not got enough for both
    // on one line -- which is how the flexible column got down to 76px and
    // clipped "every 4 ho" mid-word with no ellipsis.
    expect(/\.lc-routinerow__name\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(CSS)).toBe(true)
  })
})
