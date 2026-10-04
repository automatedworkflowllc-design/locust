import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE CHAT BOX'S ROW STAYS ONE LINE AT THE SMALLEST WINDOW (0.369).
 *
 * At 1120x720, beside the rail, the controls went onto two lines -- "+ Edit
 * folder" over "model Free effort send" -- with a free model's Free tag in
 * the model chip (metal-composer drive, packaged 0.368; one line on 0.29x).
 * Below a 720px box the folder chip steps down to its icon first: its name is
 * in the title bar and in the chip's hover, and is kept for a screen reader.
 * A missing folder keeps its words, because they are a warning.
 */
const css = readFileSync(new URL('../renderer/src/shell.css', import.meta.url), 'utf8')
// Found without writing a brace here (the check that every test asserts
// something reads test bodies by their braces).
const OPEN = String.fromCharCode(123)
const CLOSE = String.fromCharCode(125)
const query = css.indexOf(`@container (max-width: 720px) ${OPEN}`)
const selector = '.lc-composer__controls .lc-control--folder:not(.is-missing) .lc-control__folder'
const at = css.indexOf(selector, query)
const rule = at < 0 ? '' : css.slice(at, css.indexOf(CLOSE, at))

describe("the chat box's row in a narrow box", () => {
  it('lets the folder chip step down to its icon inside the narrow query', () => {
    expect(query).toBeGreaterThan(0)
    expect(at).toBeGreaterThan(query)
    // Inside the same query block: no closing of the query before the rule.
    expect(css.slice(query, at).split(CLOSE).length - 1).toBeLessThan(css.slice(query, at).split(OPEN).length - 1)
  })

  it("keeps the folder's name for a screen reader, not on screen", () => {
    expect(rule).toContain('position: absolute;')
    expect(rule).toContain('clip-path: inset(50%);')
    expect(rule).toContain('overflow: hidden;')
    expect(rule).not.toContain('display: none')
  })
})
