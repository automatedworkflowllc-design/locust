import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A Plan-mode answer is drawn in the register the teammate's prose uses.
 *
 * `PlanCard` drew it as an `lc-card`, which this app reserves for something
 * holding a control. Nothing on that surface holds one: it is the reply. The
 * design's answer (2026-09-09) was to delete the species rather than add a
 * fourth register, so the plan renders inside `lc-agentline` beside the face.
 *
 * Pinned in source because it is a claim about WHICH REGISTER a thing is in,
 * and that is not observable from the component's own markup -- `PlanSteps`
 * renders the same list in both jobs, and the register is decided by its
 * caller.
 */

const read = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../renderer/src/components/${file}`, import.meta.url)), 'utf8')

/**
 * Source with comments removed.
 *
 * The register assertions below look for class names, and the comment that
 * EXPLAINS this change says "it was an `lc-card`" in as many words -- so the
 * first version failed on a correct implementation by reading its own
 * rationale as markup. That is the fourth detector in two days to match prose
 * rather than code; `tests-assert-something.test.ts` has the same helper for
 * the same reason.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^.*?\/\/.*$/gm, ' ')
}

describe('the plan that answers a turn is not a card', () => {
  it('found the components, so a pass means something', () => {
    expect(read('Thread.tsx').length).toBeGreaterThan(1_000)
    expect(read('ThreadItems.tsx').length).toBeGreaterThan(1_000)
  })

  it('has no PlanCard left to render', () => {
    expect(read('ThreadItems.tsx')).not.toContain('export function PlanCard')
    expect(read('Thread.tsx')).not.toContain('PlanCard')
  })

  it('draws the plan item inside the agent line, not a card', () => {
    // The register itself. The plan branch must sit in `lc-agentline` -- the
    // same wrapper the teammate's prose uses -- and must not open an
    // `lc-card`.
    const thread = codeOnly(read('Thread.tsx'))
    const branch = thread.slice(thread.indexOf("if (item.type === 'plan')"))
    const body = branch.slice(0, branch.indexOf("if (item.type === 'activity')"))
    expect(body).toContain('lc-agentline')
    expect(body).toContain('PlanSteps')
    expect(body).not.toContain('lc-card')
    // The control: the ACTIVITY branch right after it does still draw a card,
    // so a `codeOnly` that ate everything would fail here rather than pass.
    expect(codeOnly(read('Thread.tsx'))).toContain('lc-card')
  })
})
