import { describe, expect, it } from 'vitest'

import { reviewBrief } from './reviewBrief.js'
import type { ReviewMaterial } from './reviewBrief.js'

/**
 * A review is shown what the CONVERSATION built, not only the last turn.
 *
 * The range was one run. A teammate that creates a file on turn two and
 * adjusts it on turn four had turn four reviewed against a WHAT CHANGED
 * naming one path, and a reviewer asked whether the request and the evidence
 * agree said -- correctly, on what it was shown -- that they did not. Correct
 * work read as incomplete work.
 *
 * It is the exact mirror of the defect Astra measured on 2026-09-14. That one
 * was the right evidence judged against the wrong request; this one is the
 * right request judged against partial evidence. The fix is the same shape
 * too: carry the missing context and LABEL it, rather than merge it in and
 * leave the reviewer unable to tell which turn is its job.
 *
 * The rule is tech-leads-club's, read 2026-09-14: the verification range is
 * the whole feature rather than the last batch.
 */

const material = (over: Partial<ReviewMaterial> = {}): ReviewMaterial => ({
  request: 'Add the export button.',
  said: 'Done — the button is wired to the existing handler.',
  changed: ['src/Toolbar.tsx'],
  commands: [{ name: 'pnpm test', exitCode: 0 }],
  ranOn: 'macOS, in shop',
  author: 'Wren',
  ...over
})

describe('what a reviewer is shown', () => {
  it('names this turn as this turn, and earlier work as earlier', () => {
    const brief = reviewBrief(material({ changedEarlier: ['src/export.ts', 'src/export.test.ts'] }))
    expect(brief).toContain('WHAT CHANGED')
    expect(brief).toContain('- src/Toolbar.tsx')
    expect(brief).toContain('CHANGED EARLIER IN THIS CONVERSATION (already done, not this turn)')
    expect(brief).toContain('- src/export.ts')
    // The two lists stay apart: this turn's work is still what is being judged.
    expect(brief.indexOf('WHAT CHANGED')).toBeLessThan(brief.indexOf('CHANGED EARLIER'))
  })

  it('does not repeat a path this turn touched again', () => {
    const brief = reviewBrief(
      material({ changed: ['src/export.ts'], changedEarlier: ['src/export.ts', 'src/other.ts'] })
    )
    // Created earlier, adjusted now: it belongs to THIS turn, once.
    expect(brief.match(/- src\/export\.ts/g)).toHaveLength(1)
    expect(brief).toContain('- src/other.ts')
  })

  it('says nothing about earlier work when there was none', () => {
    expect(reviewBrief(material())).not.toContain('CHANGED EARLIER')
    expect(reviewBrief(material({ changedEarlier: [] }))).not.toContain('CHANGED EARLIER')
  })

  it('carries earlier work into a turn that only answered -- where it matters most', () => {
    /*
     * The worst case, and the one the two-negatives branch used to swallow:
     * a turn that answered a question, in a conversation that had already
     * built the thing. The brief said "it changed no files and ran no
     * commands" and stopped, which is exactly where a reviewer concludes the
     * work was never done.
     */
    const brief = reviewBrief(
      material({ changed: [], commands: [], changedEarlier: ['src/export.ts'] })
    )
    expect(brief).toContain('This turn answered in the conversation')
    expect(brief).toContain('CHANGED EARLIER IN THIS CONVERSATION')
    expect(brief).toContain('- src/export.ts')
  })

  it('still makes no claim about whether the work is good', () => {
    const brief = reviewBrief(material({ changedEarlier: ['src/export.ts'] }))
    // The brief's oldest discipline: handing a reviewer the answer is not a
    // review. "already done" describes WHEN, never whether it was done well.
    expect(brief).not.toMatch(/looks (?:right|correct|done)|appears correct|passed/i)
  })
})
