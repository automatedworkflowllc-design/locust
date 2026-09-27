import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * THE RUNTIME MARKS' COLOURS ARE TOKENS (0.383).
 *
 * Claude's orange and Gemini's gradient are part of those marks (Gemini's
 * since 0.384, Google's own sparkle); every other runtime's mark is drawn in
 * the colour of the words beside it. The first cut
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
  it('is a token, for every mark whose colour is part of the mark', () => {
    expect(tokens).toContain('--lc-mark-claude: #d97757;')
    // The three stops of Google's own sparkle, exactly as its file has them.
    expect(tokens).toContain('--lc-mark-gemini-violet: #9168c0;')
    expect(tokens).toContain('--lc-mark-gemini-blue: #5684d1;')
    expect(tokens).toContain('--lc-mark-gemini-cyan: #1ba1e3;')
  })

  it('is painted by runtime for Claude alone: Gemini carries its gradient in the mark', () => {
    expect(shell).toMatch(/\.lc-runtimemark\[data-runtime='claude'\] \{\s*color: var\(--lc-mark-claude\);/)
    expect([...shell.matchAll(/\.lc-runtimemark\[data-runtime='([a-z]+)'\]/g)].map((match) => match[1])).toEqual(['claude'])
  })

  it("rings an account's usage in the app's own tones: muted, amber from 80%, red when spent (0.388)", () => {
    expect(shell).toMatch(/\.lc-usagering__arc \{\s*stroke: var\(--lc-text-muted\);/)
    expect(shell).toMatch(/\.lc-usagering\.is-pressing \.lc-usagering__arc \{\s*stroke: var\(--lc-amber\);/)
    expect(shell).toMatch(/\.lc-usagering\.is-spent \.lc-usagering__arc \{\s*stroke: var\(--lc-red\);/)
  })

  it('goes grey with its words when the runtime cannot take work, brand colour and all', () => {
    // `[data-runtime]` lifts the muted rule over the brand's, whatever the order.
    expect(shell).toMatch(/\.lc-runtimemark\.is-muted\[data-runtime\] \{\s*color: inherit;\s*opacity: 0\.5;/)
  })
})
