import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every `--lc-*` token the stylesheet uses is a token the stylesheet defines.
 *
 * A `var()` naming something undefined does not warn and does not fail. The
 * declaration becomes invalid at computed-value time and the property falls
 * back to its initial value, which for a `border` shorthand is
 * `border-color: currentColor` — so the rule still draws a border, in the TEXT
 * colour, and looks deliberate.
 *
 * Found on `--lc-border`, which was never defined and was used four times:
 * the attachment tile, the "copied in" segment, the sent-file chip and the
 * plain notice. Every one of them had been drawing a solid `#c7c3bc` line
 * where a `rgba(255,255,255,0.09)` hairline was meant, since 0.47.0. Nobody
 * noticed because a heavier border reads as a choice.
 *
 * The design agent had the same class of defect in their own drawings the same
 * week — 49 `var()` calls naming a token they had retired — and caught it by
 * checking. This is that check, on our side, where it can run every time.
 */

const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const read = (file: string): string => readFileSync(`${SRC}${file}`, 'utf8')

/** Tokens the sheets DEFINE: `--lc-foo:` at the start of a declaration. */
function defined(css: string): ReadonlySet<string> {
  return new Set([...css.matchAll(/(--lc-[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''))
}

/** Tokens the sheets USE: `var(--lc-foo)`, including a fallback form. */
function used(css: string): ReadonlySet<string> {
  return new Set([...css.matchAll(/var\(\s*(--lc-[a-z0-9-]+)/g)].map((match) => match[1] ?? ''))
}

const tokens = read('tokens.css')
const shell = read('shell.css')
const everything = `${tokens}\n${shell}`

describe('no stylesheet paints with a token nobody defined', () => {
  it('found the sheets, and can tell a definition from a use', () => {
    // The control. A wrong path or a broken regex reports a clean sheet by
    // reading nothing, which is the same green.
    expect(tokens.length).toBeGreaterThan(1_000)
    expect(shell.length).toBeGreaterThan(10_000)
    expect(defined(everything).size).toBeGreaterThan(80)
    expect(used(everything).size).toBeGreaterThan(80)
    expect(defined('  --lc-thing: red;').has('--lc-thing')).toBe(true)
    expect(used('border: 1px solid var(--lc-thing);').has('--lc-thing')).toBe(true)
    // A use is not a definition, which is the distinction the whole check rests on.
    expect(defined('border: 1px solid var(--lc-thing);').has('--lc-thing')).toBe(false)
  })

  it('every token used is defined', () => {
    const known = defined(everything)
    const missing = [...used(everything)].filter((token) => !known.has(token)).sort()
    expect(missing).toEqual([])
  })
})
