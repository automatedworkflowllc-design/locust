import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The static sweep of 2026-09-14, kept closed.
 *
 * It read `tokens.css`, all 8,700 lines of `shell.css` and the component
 * tree, grepping one defect class at a time rather than reading for
 * impressions. Two of its findings are worth a permanent control.
 *
 * **A1 — no focus indicator.** `tokens.css` gives every input a 2px focus
 * ring; four of them set `outline: none` and put nothing back, and their
 * wrappers changed border on `:hover` only. Tabbing into the composer
 * produced no visual change whatsoever. The command palette was the worst of
 * the four: a surface that is keyboard-only by nature, whose input is the
 * first thing focused. This is the only accessibility defect the sweep
 * found, and an invisible focus ring is invisible to every test we had.
 *
 * **A4 — `var()` fallbacks.** Three disagreed with the tokens they fell back
 * to, and all of them were unreachable, which is exactly the problem: the
 * build fails on an undefined `var()`, and a fallback silently satisfies the
 * browser instead. **A fallback defeats the gate.** So none are allowed,
 * including the ones that happen to be correct today — being correct today
 * is not the property that matters.
 */

const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const shell = readFileSync(RENDERER + 'shell.css', 'utf8')
const tokens = readFileSync(RENDERER + 'tokens.css', 'utf8')

/** Every input that hides its own outline needs a wrapper that shows focus. */
const WRAPPERS = ['.lc-search', '.lc-composer__box', '.lc-palette__head', '.lc-picker__head'] as const

describe('a keyboard user can see where they are', () => {
  for (const wrapper of WRAPPERS) {
    it(`${wrapper} shows focus`, () => {
      expect(shell).toContain(`${wrapper}:focus-within {`)
    })
  }

  it('shows focus as a glow on the two fields, not a hard outline', () => {
    /*
     * The indicator has to exist -- an invisible one was the only
     * accessibility defect the static sweep found. It does not have to
     * shout: Colin, 2026-09-14, "the yellow outline for clicking the chat
     * box is pointless and clunky, just do what claude does, a very subtle
     * highlight/glow of the same color".
     *
     * So: same hue, a fraction of the weight. What this guards is that
     * softening it never becomes removing it.
     */
    for (const field of ['.lc-composer__box:focus-within {', '.lc-search:focus-within {']) {
      const rule = shell.slice(shell.indexOf(field), shell.indexOf('}', shell.indexOf(field)))
      expect(rule, `${field} must still say where focus is`).toContain('box-shadow')
      expect(rule).toContain('--lc-focus-glow')
      // The hard 2px lime edge is what was too loud.
      expect(rule).not.toContain('border-color: var(--lc-focus-ring)')
    }
  })

  it('lets focus win over hover, which needs source order at equal specificity', () => {
    // One class and one pseudo-class each, so nothing but position decides.
    // A focused box under the pointer must read as focused.
    for (const wrapper of ['.lc-search', '.lc-composer__box']) {
      const hover = shell.indexOf(`${wrapper}:hover {`)
      const focus = shell.indexOf(`${wrapper}:focus-within {`)
      expect(hover, `${wrapper}:hover should exist`).toBeGreaterThan(-1)
      expect(focus, `${wrapper}:focus-within must come after :hover`).toBeGreaterThan(hover)
    }
  })

  it('rings on :focus-visible, not :focus, so a mouse press does not draw one', () => {
    expect(shell).not.toContain('.lc-input:focus {')
    expect(shell).toContain('.lc-input:focus-visible {')
  })
})

describe('nothing may defeat the undefined-token gate', () => {
  it('has no var() fallbacks at all, including the correct ones', () => {
    // `var(--lc-x, #hex)`. The build fails on an undefined token; a fallback
    // makes the browser succeed quietly instead, which is the whole hazard.
    const guilty = shell
      .split(String.fromCharCode(10))
      .map((line, index) => ({ line: line.trim(), at: index + 1 }))
      .filter(({ line }) => /var\(--lc-[a-z0-9-]+,/i.test(line))
      .map(({ line, at }) => `shell.css:${String(at)}: ${line}`)
    expect(guilty).toEqual([])
  })

  it('keeps colour in tokens, not in literal hexes', () => {
    // The two that were literals: violet and clay peer names. They were
    // contrast-checked honestly and still lived in the one file the gate is
    // meant to police. The fix was to finish the set, not to opt out of it.
    expect(tokens).toContain('--lc-violet-text:')
    expect(tokens).toContain('--lc-clay-text:')
    expect(shell).not.toContain('#c9b8f3')
    expect(shell).not.toContain('#f0aea6')
  })
})

describe('faint is only for what paints no readable text', () => {
  it('does not put it on a count, which is the only varying thing on its row', () => {
    const at = shell.indexOf('.lc-sectionlabel__count {')
    expect(at).toBeGreaterThan(-1)
    expect(shell.slice(at, at + 200)).not.toContain('var(--lc-text-faint)')
  })
})
