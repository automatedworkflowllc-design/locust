import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The thread's taxonomy, enforced.
 *
 * The design review (2026-09-06) counted NINETEEN visual species in
 * `.lc-thread__column` and named the cause precisely: "It is a taxonomy
 * problem: there is no rule saying what deserves to be a card, so each new
 * fact arrived as a new species, and the column now reads as a feed of
 * unrelated widgets."
 *
 * Every individual reassignment it asked for was then built -- the plan into
 * the fold, memory as a left-ruled note, the temporary limit as a note, the
 * mission-id line deleted, the peer exchange as words, the receipt collapsed
 * to one line. What was never built is the RULE, and the rule is the part that
 * stops it happening again. Two separate audits have since had to re-derive
 * "is this still true" by reading files, and both got it wrong in both
 * directions.
 *
 * So the rule lives here, as a test over the source:
 *
 *   PENDING  (amber)  something is waiting for you; the card holds a control
 *   TERMINAL (red)    the run could not continue; nothing to press
 *   STANDING (quiet)  a fact that already happened; nothing to press
 *
 * A new `lc-card` with no register fails this test. That is the whole point:
 * the next person to add a fact to the thread has to say which of the three it
 * is, and cannot quietly invent a twentieth species.
 *
 * It lives under `src/main` rather than beside the components it reads because
 * it reads them FROM DISK: the renderer's tsconfig has no Node types, and a
 * test about source text is not a renderer module. It asserts nothing about
 * behaviour, only about the vocabulary the components are allowed to use.
 */

// Resolved from THIS file, not the working directory -- see the note in
// block-placement.test.ts. A cwd-relative path made this file pass under the
// ship gate and fail under `pnpm test`, which is the worst way round.
const COMPONENTS = fileURLToPath(new URL('../renderer/src/components/', import.meta.url))

const sourceOf = (file: string): string => readFileSync(join(COMPONENTS, file), 'utf8')

/** Every `className="lc-card ..."` in a file, with its modifier classes. */
function cardClasses(source: string): readonly string[] {
  return [...source.matchAll(/className=(?:"|\{`)(lc-card[^"`]*)(?:"|`)/g)].map((match) => match[1] ?? '')
}

const THREAD_FILES = ['Thread.tsx', 'ApprovalCard.tsx', 'DecisionCard.tsx', 'ResumeCard.tsx', 'CancellationCard.tsx', 'MemoryCard.tsx']

describe('every card in the thread declares which register it is in', () => {
  it('finds cards to check, so a passing run means something', () => {
    // The control. A regex that matched nothing would make every assertion
    // below vacuously true, which is the usual way a source-reading test rots.
    const found = THREAD_FILES.flatMap((file) => cardClasses(sourceOf(file)))
    expect(found.length).toBeGreaterThan(3)
  })

  it('gives each one exactly one register', () => {
    for (const file of THREAD_FILES) {
      for (const className of cardClasses(sourceOf(file))) {
        // `lc-card__head` and friends are parts of a card, not cards.
        if (/^lc-card__/.test(className)) continue
        const registers = ['is-pending', 'is-terminal', 'is-standing'].filter((register) =>
          className.split(/\s+/).includes(register)
        )
        expect(registers, `${file}: "${className}"`).toHaveLength(1)
      }
    }
  })

  it('keeps amber for cards that are actually waiting on you', () => {
    // The specific failure this was written after: the cancellation summary and
    // the "cannot be resumed" note both wore `is-amber`, the colour an approval
    // uses while it holds a run open, and neither has a control in it. One
    // colour doing two jobs is how a person learns to ignore the colour.
    for (const file of ['CancellationCard.tsx', 'ResumeCard.tsx']) {
      const source = sourceOf(file)
      for (const className of cardClasses(source)) {
        if (!className.includes('is-amber')) continue
        // An amber card has to contain a button somewhere in its file.
        expect(source, `${file} has an amber card`).toMatch(/<button/)
      }
    }
  })

  it('never puts a card in the pending register without a control', () => {
    for (const file of THREAD_FILES) {
      const source = sourceOf(file)
      const pending = cardClasses(source).filter((className) => className.split(/\s+/).includes('is-pending'))
      if (pending.length === 0) continue
      expect(source, `${file} draws a pending card`).toMatch(/<button/)
    }
  })
})
