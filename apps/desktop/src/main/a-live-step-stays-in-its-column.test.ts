import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A COMPARE COLUMN'S LIVE LINE STAYS IN ITS COLUMN (0.631).
 *
 * Colin, 2026-10-05, with a three-column Blind compare: column B's live
 * words -- "Final regression playthroughs across classes and layouts" --
 * ran past its column into column C. `.lc-livestep__label` had `flex: none`
 * so a long tool name could not paint over "Using a tool" (2026-09-30); since
 * 0.569 that label carries the model's own step text, which can be long, and
 * nothing clipped it.
 *
 * Made to shrink as one span, the line cut the clock first and left a sliver
 * of the note ("acr… · np…"). So the line is three pieces: the words, which
 * ellipsize only when they alone do not fit; the clock right after them,
 * which never shrinks; and the note last, shown when there is room for it to
 * say something and not at all when there is not.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const threadItems = readFileSync(fileURLToPath(new URL('../renderer/src/components/ThreadItems.tsx', import.meta.url)), 'utf8')

const rule = (selector: string): string => {
  const at = shell.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return shell.slice(at, shell.indexOf('\n}', at) + 2)
}

/** The property lines only -- the comments above a rule name old values. */
const declarations = (selector: string): string =>
  rule(selector)
    .split('\n')
    .filter((line) => /^\s+[a-z-]+:/.test(line))
    .join('\n')

describe('a live step stays in its column', () => {
  it('lets the row shrink inside a narrow compare cell', () => {
    expect(declarations('.lc-livestep')).toMatch(/min-width:\s*0/)
  })

  it('lets the words shrink and ellipsize, with the whole line on hover', () => {
    const label = declarations('.lc-livestep__label')
    expect(label).toMatch(/flex:\s*0\s+1\s+auto;/)
    expect(label).not.toMatch(/flex:\s*none;/)
    expect(label).toMatch(/min-width:\s*0/)
    expect(label).toMatch(/overflow:\s*hidden/)
    // Placed after the base `.lc-sweep` rule so this selector does not steal
    // the-live-word-is-visibly-live's `indexOf('.lc-sweep {')`.
    const words = declarations('.lc-livestep__register .lc-sweep')
    expect(words).toMatch(/text-overflow:\s*ellipsis/)
    expect(words).toMatch(/min-width:\s*0/)
    // The note can be hidden for room, so the hover says it too.
    expect(threadItems).toMatch(/className="lc-livestep__label" title=\{\[headline, \.\.\.aside\]\.join\(' · '\)\}/)
  })

  it('draws the words, then the clock, then the note', () => {
    const line = threadItems.slice(threadItems.indexOf('export function LiveRegisterLine'))
    const label = line.indexOf('className="lc-livestep__label"')
    const clock = line.indexOf('className="lc-rail__meta lc-livestep__clock"')
    const note = line.indexOf('className="lc-rail__meta lc-livestep__note"')
    expect(label).toBeGreaterThan(0)
    expect(clock).toBeGreaterThan(label)
    expect(note).toBeGreaterThan(clock)
  })

  it('never shrinks the clock', () => {
    const clock = declarations('.lc-livestep__clock')
    expect(clock).toMatch(/flex:\s*none/)
    expect(clock).toMatch(/white-space:\s*nowrap/)
    expect(rule('.lc-livestep__clock::before')).toMatch(/content:\s*'· '/)
  })

  it('gives the note only the room left, and hides it when that room says nothing', () => {
    const note = declarations('.lc-livestep__note')
    // Base size 0: the note takes leftover room and never pushes the words.
    expect(note).toMatch(/flex:\s*1\s+1\s+0;/)
    expect(note).toMatch(/min-width:\s*0/)
    // One line tall; a note that does not fit wraps onto a clipped second line.
    expect(note).toMatch(/flex-wrap:\s*wrap/)
    expect(note).toMatch(/height:\s*1lh/)
    expect(note).toMatch(/overflow:\s*hidden/)
    // The empty first item it wraps under must be a line tall: with no height
    // the second line sits on the first and the note still shows (found in
    // the look tool's frames, 0.631).
    const first = declarations('.lc-livestep__note::before')
    expect(first).toMatch(/content:\s*''/)
    expect(first).toMatch(/height:\s*1lh/)
    // Shown with an ellipsis when twelve characters fit; wrapped away when not.
    const meta = declarations('.lc-livestep__meta')
    expect(meta).toMatch(/min-width:\s*12ch/)
    // Less the gap it carries inside: at 100% a long note never fit its line
    // and was always hidden (seen in the look tool's frames, 0.631).
    expect(meta).toMatch(/max-width:\s*calc\(100% - var\(--lc-space-4\)\)/)
    expect(meta).toMatch(/margin-left:\s*var\(--lc-space-4\)/)
    expect(note).toMatch(/margin-left:\s*calc\(-1 \* var\(--lc-space-4\)\)/)
    expect(meta).toMatch(/text-overflow:\s*ellipsis/)
    expect(meta).toMatch(/white-space:\s*nowrap/)
  })
})
