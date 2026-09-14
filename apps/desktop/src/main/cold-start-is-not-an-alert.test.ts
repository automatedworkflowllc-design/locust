import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * "Started without the earlier messages" is a marker, not an alert.
 *
 * The line is true and worth saying: when the previous turn left no session
 * to resume, the model starts this turn cold. The conversation is one
 * thread; the runtime's memory of it is not.
 *
 * It was rendered at the very END of the thread -- after the approval cards,
 * hard against the composer. That is the register live and pending things
 * live in, so a durable fact about the past read as a live warning about the
 * present. Colin, 2026-09-14, looking at one on a Cursor turn that had
 * followed a failed run: *"is that alert at the bottom about memory bc of
 * the update, also its not disappearing"*.
 *
 * Both halves of that are the placement's doing. It is not about memory and
 * not about the update, and there is nothing to dismiss -- it will never
 * disappear, because the turn will always have started cold. Put beside the
 * time marker that OPENS the turn, it reads as what it is: where this turn
 * began, above the work it explains.
 *
 * The rule this pins is ordering, because ordering is the whole defect.
 */

const THREAD = fileURLToPath(new URL('../renderer/src/components/Thread.tsx', import.meta.url))

const COLD = 'Started without the earlier messages'

describe('where the cold-start marker is drawn', () => {
  const source = readFileSync(THREAD, 'utf8')
  const at = (needle: string): number => {
    const index = source.indexOf(needle)
    expect(index, `expected to find ${needle} in Thread.tsx`).toBeGreaterThan(-1)
    return index
  }

  it('sits above the work it describes, not below it', () => {
    // The current turn's own items. If the marker follows them it is
    // describing something the reader has already scrolled past.
    expect(at(COLD)).toBeLessThan(at('items={items}'))
  })

  it('is nowhere near the approvals, which are what the run is waiting on', () => {
    // Approvals are deliberately last -- they are pending, and they belong
    // where the reader's eye already is. A fact about the past sharing that
    // position is what made this read as a live alert.
    expect(at(COLD)).toBeLessThan(at('approvals.map'))
  })

  it('opens the turn, beside the time marker that already does', () => {
    const marker = at(COLD)
    const time = at('currentMarker !== undefined')
    expect(marker).toBeLessThan(time)
    // Adjacent, not merely earlier: anything of substance between them and
    // it stops reading as part of the turn's opening.
    expect(source.slice(marker, time)).not.toContain('<ThreadItems')
  })

  it('still says the thing worth saying', () => {
    expect(source).toContain('left no session to resume')
  })

  it('is a real control: it catches the placement that shipped', () => {
    // The old order, as it stood in 0.120.0: approvals, then the marker,
    // then the composer. Asserted as text so this test would have failed
    // against the code it was written for.
    const shipped = ['approvals.map', 'items={items}', COLD].join(' ... ')
    expect(shipped.indexOf(COLD)).toBeGreaterThan(shipped.indexOf('items={items}'))
    expect(shipped.indexOf(COLD)).toBeGreaterThan(shipped.indexOf('approvals.map'))
  })
})
