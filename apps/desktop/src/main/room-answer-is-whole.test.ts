import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A room answer is whole.
 *
 * This file used to guard the FOLD. Its history is worth keeping, because it
 * is the reason the fold was ever believed to be right: the first version
 * split the answer on newlines, and a three-paragraph prose reply has TWO of
 * them, so `3 <= 12` and it rendered whole -- seventeen or more rendered
 * lines of it. The fixture I wrote used 40 newlines, the counting workload
 * from the cap probe, which is the one shape that folds perfectly. The
 * design agent caught it and the clamp moved to CSS line boxes.
 *
 * Then Colin removed the fold outright, 2026-09-11: "just let them post
 * uninhibited in chat." A room is where two teammates argue in front of you;
 * the argument is the content, and a summary nobody asked for is the wrong
 * default for that surface.
 *
 * What the fold was partly covering for is fixed rather than hidden: long
 * answers looked broken in a room because the live event window was eating
 * their beginnings, so opening a fold revealed a reply starting mid-sentence
 * (`shared/messageFragments.ts`).
 *
 * So this now guards the absence, in both files, because a clamp is one CSS
 * rule away from coming back by accident.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const COMPONENT = readFileSync(
  fileURLToPath(new URL('../renderer/src/components/RoomScreen.tsx', import.meta.url)),
  'utf8'
)

describe('a room answer is not folded', () => {
  it('has no clamp on it', () => {
    expect(CSS, 'a room answer is being clamped again').not.toMatch(/\.lc-roomanswer__text[^{]*\{[^}]*line-clamp/)
    expect(CSS, 'a room answer is being bounded by height again').not.toMatch(/\.lc-roomanswer__text[^{]*\{[^}]*max-height/)
  })

  it('offers nothing to open, because nothing is hidden', () => {
    // The control itself, not the words: this file's own comment says
    // "Show the rest" while explaining why there is no longer one, and a
    // guard that a comment can trip is a guard nobody trusts.
    expect(COMPONENT, 'the fold control is back').not.toMatch(/className="lc-shellout__more"/)
    expect(COMPONENT, 'the fold state is back').not.toMatch(/is-folded/)
  })

  it('never counts newlines to decide what to show', () => {
    /*
     * THE original regression, kept as a guard because it is the shape
     * rather than the symptom: splitting the text is how the wrong number
     * gets computed, and it looks perfectly reasonable in a diff.
     */
    expect(COMPONENT, 'something is counting newlines again').not.toMatch(/text\.split\(/)
  })
})
