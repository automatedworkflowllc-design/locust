import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * THE RUNTIME MARKS' COLOURS ARE TOKENS (0.383).
 *
 * Claude's orange and Gemini's violet are part of those marks; every other
 * runtime's mark is drawn in the colour of the words beside it. The first cut
 * set the colour on the element through a custom property with a `var()`
 * fallback, and the token gate refused both: a fallback defeats the gate, and
 * a colour belongs in `tokens.css`. The renderer's `RuntimeMark` sets no
 * colour at all (the-runtimes-wear-their-marks.test.tsx); this pins where the
 * colour comes from instead.
 */
const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../renderer/src/${name}`, import.meta.url)), 'utf8')
const tokens = read('tokens.css')
const shell = read('shell.css')

describe("a runtime mark's colour", () => {
  it('is a token, for the two marks whose colour is part of the mark', () => {
    expect(tokens).toContain('--lc-mark-claude: #d97757;')
    expect(tokens).toContain('--lc-mark-gemini: #8e75b2;')
  })

  it('is painted by runtime, on exactly those two', () => {
    expect(shell).toMatch(/\.lc-runtimemark\[data-runtime='claude'\] \{\s*color: var\(--lc-mark-claude\);/)
    expect(shell).toMatch(/\.lc-runtimemark\[data-runtime='gemini'\] \{\s*color: var\(--lc-mark-gemini\);/)
    expect([...shell.matchAll(/\.lc-runtimemark\[data-runtime='([a-z]+)'\]/g)].map((match) => match[1]).sort()).toEqual(['claude', 'gemini'])
  })

  it('goes grey with its words when the runtime cannot take work, brand colour and all', () => {
    // `[data-runtime]` lifts the muted rule over the brand's, whatever the order.
    expect(shell).toMatch(/\.lc-runtimemark\.is-muted\[data-runtime\] \{\s*color: inherit;\s*opacity: 0\.5;/)
  })
})
