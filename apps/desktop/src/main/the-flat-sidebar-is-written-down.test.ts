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
