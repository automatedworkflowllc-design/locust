import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A tone class wins on specificity, not on where it sits in the file.
 *
 * `lc-tone-amber` and friends say what a piece of text is FOR. They were
 * plain single-class rules near the top of a 7,500-line stylesheet, so every
 * component that set its own `color` further down beat them -- same
 * specificity, later rule wins -- and text asked to be amber came out grey.
 *
 * It was found and patched three times before it was fixed once:
 *
 *   0906 review  the Auto menu descriptions. Measured 2026-09-08 as
 *                rgb(139,145,144) instead of #efc969, and patched with a
 *                more specific copy of the same declaration further down.
 *   earlier      a runtime row's usage figure, patched the same way, with a
 *                comment reading "same specificity, later wins".
 *   2026-09-09   `.lc-settings__note`, which every note in the room form
 *                uses -- so a new over-cap warning read grey, and so had the
 *                form's own ERROR messages, in red that never rendered.
 *
 * Doubling the class takes the rule to (0,2,0), which beats any single-class
 * rule wherever either one sits. This is the control that stops the fourth
 * instance: a tone re-added at single-class specificity fails here rather
 * than being noticed in a screenshot two releases later.
 */

const CSS = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')

/** The tone names the stylesheet defines, whatever they happen to be. */
export function toneNames(css: string): readonly string[] {
  const found = new Set<string>()
  for (const match of css.matchAll(/\.lc-tone-([a-z]+)\b/g)) found.add(match[1] ?? '')
  found.delete('')
  return [...found].sort()
}

/** Every selector in the file that sets `color`, as written. */
function colorRules(css: string): readonly string[] {
  const rules: string[] = []
  // Comments first. Everything between one rule's `}` and the next rule's
  // `{` is read as the selector, so the block comment above a rule becomes
  // part of it -- and the comment explaining this very fix was reported as
  // a stray per-component copy. Fourth time in this repository that a
  // detector has matched prose instead of code.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const match of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/(?:^|[;\s])color\s*:/.test(match[2] ?? '')) rules.push((match[1] ?? '').replace(/\s+/g, ' ').trim())
  }
  return rules
}

describe('the tone classes', () => {
  it('are there to be found', () => {
    // The control. A renamed convention would otherwise make every
    // assertion below pass over an empty list.
    const names = toneNames(CSS)
    expect(names).toContain('amber')
    expect(names).toContain('red')
    expect(names.length).toBeGreaterThanOrEqual(5)
    expect(colorRules(CSS).length).toBeGreaterThan(100)
  })

  it('each set their colour at doubled specificity', () => {
    for (const name of toneNames(CSS)) {
      const doubled = `.lc-tone-${name}.lc-tone-${name}`
      expect(CSS, `${name} must win on specificity, not position`).toContain(`${doubled} {`)
    }
  })

  it('are never declared as a bare single class again', () => {
    /*
     * THE regression, stated exactly. `.lc-tone-amber { color: ... }` on its
     * own is the shape that loses, and it is the shape someone adding a
     * seventh tone would naturally write by copying the six above it.
     */
    for (const name of toneNames(CSS)) {
      const bare = colorRules(CSS).filter((selector) => selector === `.lc-tone-${name}`)
      expect(bare, `.lc-tone-${name} alone loses to any later component colour`).toEqual([])
    }
  })

  it('need no per-component copies any more', () => {
    // Both earlier patches were a more specific copy of the same
    // declaration. With the tone winning on its own they are dead weight,
    // and a new one appearing means the general fix stopped holding.
    const copies = colorRules(CSS).filter(
      (selector) => /\.lc-[a-z]/.test(selector.replace(/\.lc-tone-[a-z]+/g, '')) && /\.lc-tone-/.test(selector)
    )
    expect(copies).toEqual([])
  })
})
