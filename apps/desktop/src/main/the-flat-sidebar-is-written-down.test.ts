import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The flat sidebar, as it is written rather than as it behaves.
 *
 * Its ordering is guarded next door in
 * `renderer/src/the-flat-sidebar.test.ts`; this half reads the stylesheet
 * and the components, which needs node types and so has to live here.
 */

const SIDEBAR = readFileSync(fileURLToPath(new URL('../renderer/src/components/Sidebar.tsx', import.meta.url)), 'utf8')
const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const APP = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')

const rule = (selector: string): string => {
  const at = CSS.indexOf(selector)
  expect(at, `${selector} should exist`).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('the conversation row', () => {
  it('lets only the title give, so nothing is pushed off the edge', () => {
    // The same trick the composer row needed: without `min-width: 0` a long
    // title refuses to shrink and shoves the age out of the column instead.
    expect(rule('.lc-conv__title {')).toContain('min-width: 0')
    expect(rule('.lc-conv__title {')).toContain('text-overflow: ellipsis')
    expect(rule('.lc-conv__age {')).toContain('flex: none')
  })

  it('is one line, never two', () => {
    // A list you scan stops being scannable the moment its rows differ in
    // height.
    expect(rule('.lc-conv {')).toContain('height: 28px')
    expect(rule('.lc-conv__title {')).toContain('white-space: nowrap')
  })

  it('keeps the unowned row aligned with every other one', () => {
    // A row that shuffled left because nobody owns it would read as a
    // different KIND of thing, which it is not.
    expect(rule('.lc-conv__nobody {')).toContain('width: 16px')
  })

  it('lines the ages up', () => {
    expect(rule('.lc-conv__age {')).toContain('tabular-nums')
  })
})

describe('the title is cut by the column, not before it', () => {
  it('does not cap the title in JavaScript', () => {
    /*
     * `missionTitle` used to stop at 44 characters and CSS then ellipsised
     * again to whatever the column was -- about 22. The second cut was
     * invisible and the first was a CEILING: widening the column could never
     * show more than 44 however much room it had, so the flat list's extra
     * pixels would have bought nothing on their own.
     */
    const body = APP.slice(APP.indexOf('function missionTitle'), APP.indexOf('function missionTitle') + 1400)
    expect(body).not.toContain('slice(0, 44)')
    expect(body).toContain('return trimmed')
  })

  it('still takes the first line and drops the attachment preamble', () => {
    // Those are about WHAT the title is, not how long it may be.
    const body = APP.slice(APP.indexOf('function missionTitle'), APP.indexOf('function missionTitle') + 1400)
    expect(body).toContain('splitAttachments')
    expect(body).toContain("split('\\n')[0]")
  })
})

describe('the roster is one row, and the rail is left alone', () => {
  it('draws the faces only in the wide sidebar', () => {
    expect(SIDEBAR).toContain('{!compact && teammates.length > 0 && (')
    expect(SIDEBAR).toContain('lc-faces__one')
  })

  it('keeps the way to the full roster in a fixed place', () => {
    // Pushed to the end, so however many faces there are it does not move.
    expect(rule('.lc-faces__team {')).toContain('margin-left: auto')
  })

  it('says when the list is filtered, because a filtered list that does not looks like a list that lost things', () => {
    expect(SIDEBAR).toContain('lc-faces__clear')
    expect(SIDEBAR).toContain('show all')
  })

  it('still gives the rail the layout it already had', () => {
    /*
     * 268px and 64px are different problems. Four pixels of a title is not a
     * smaller list, it is a decoration that lies about being one, so the
     * rail keeps the avatar-and-flyout shape Grok verified on 2026-09-15.
     * Rebuilding a working rail to match a change it does not share is how
     * the last rail attempt broke.
     */
    expect(SIDEBAR).toContain('{compact ? (')
    expect(SIDEBAR).toContain('lc-convlist')
  })
})

describe('nothing loses its way in', () => {
  /*
   * THIS IS THE ONE I SHIPPED BROKEN.
   *
   * 0.139.0 flattened the sidebar into a conversation list and moved every
   * old section behind `compact`, which left Rooms and Routines with nowhere
   * to be in the wide sidebar at all. Driven after release: no button, no
   * label, and a room that existed drawn nowhere.
   *
   * It is the exact failure the design brief warned about, because it had
   * already happened once -- rooms reachable only from the palette, and
   * Colin, 2026-09-09: "sorry if this is dumb but how does one create a room
   * for teammates, i cant figure it out lol." Not dumb; there was nothing on
   * screen to find.
   *
   * A feature with no way in is not a smaller feature. It is an absent one.
   */
  for (const name of ['Missions', 'Rooms', 'Routines', 'Settings']) {
    it(`${name} has a button in the footer`, () => {
      const footer = SIDEBAR.slice(SIDEBAR.indexOf('lc-sidebar__footer'))
      expect(footer).toContain(`<span>${name}</span>`)
    })
  }

  it('the roster is reachable too, from the faces row rather than the footer', () => {
    /*
     * The rule is REACHABILITY, not a location. This test listed Teammates
     * among the footer buttons until 0.142.0, when it came out of the footer
     * on purpose: the faces row and its `Team` pill are the way to the
     * roster, so a footer link was a second door to one room -- and removing
     * it freed the two cells that let the status line say its whole
     * sentence.
     *
     * Asserted where the door actually is, so the guard still fails if the
     * roster loses its way in, and does not fail merely because it moved.
     */
    expect(SIDEBAR).toContain('lc-faces__team')
    expect(SIDEBAR).toContain('onOpenTeammates')
  })

  it('gives the roster its full word back, which the narrow row could not hold', () => {
    /*
     * "Team" was the shorter answer when three labelled cells shared 266px
     * and "Teammates" rendered as "Teamma…". Measured at two rows: the cell
     * is 82px and the word is 55px of ink.
     *
     * Scoped to the FOOTER. The faces row has its own `Team` beside the
     * avatars and that one is right -- it sits in a 26px-tall strip next to
     * four faces, where the long word would be the loudest thing in the row.
     * A first version of this test asserted on the whole file and failed on
     * that button, which is a guard measuring the wrong control.
     */
    const footer = SIDEBAR.slice(SIDEBAR.indexOf('lc-sidebar__footer'))
    expect(footer).not.toContain('<span>Team</span>')
    // And no full word either: the footer stopped carrying the roster at all.
    expect(footer).not.toContain('<span>Teammates</span>')
  })

  it('keeps every footer cell sharing the width rather than claiming it', () => {
    /*
     * The scar this row carries: laid out by content, three labelled buttons
     * came to 371px inside a 266px column and pushed the count clean off the
     * edge. Two rows of equal thirds is what lets five labels fit; a cell
     * that sizes itself would reopen it.
     */
    expect(rule('.lc-sidebar__nav {')).toContain('repeat(3, minmax(0, 1fr))')
    expect(rule('.lc-sidebar__nav .lc-connected {')).toContain('min-width: 0')
  })
})
