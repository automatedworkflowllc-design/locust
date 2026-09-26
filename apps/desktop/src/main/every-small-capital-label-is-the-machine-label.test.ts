import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * EVERY SMALL CAPITALISED LABEL IS THE MACHINE'S LABEL (sweep D4).
 *
 * The sweep counted four ways to draw a small label; the stylesheet had 37
 * rules setting text in capitals in 24 combinations of face, size and
 * tracking -- 10px beside 10.5px, 0.04em, 0.06em and 0.1em beside the
 * label's 0.14em. The design system's own rule is one label: Geist Mono is
 * the machine's voice, uppercase section labels included, at
 * --lc-text-mono-label and --lc-tracking-label (-wide for a section or group
 * head). Colin, 2026-09-23: "I'll let you run with your decision".
 *
 * On the way two labels turned out to set their size to a COLOUR --
 * `font-size: var(--lc-text-muted)` -- which a browser drops, so they drew at
 * whatever their parent was. The second test is that class of mistake.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const tokens = readFileSync(fileURLToPath(new URL('../renderer/src/tokens.css', import.meta.url)), 'utf8')
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))

function rules(css: string): { readonly selector: string; readonly props: Record<string, string> }[] {
  const found: { readonly selector: string; readonly props: Record<string, string> }[] = []
  for (const match of withoutComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props: Record<string, string> = {}
    for (const declaration of match[2]!.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) props[declaration[1]!.trim()] = declaration[2]!.trim()
    found.push({ selector: match[1]!.replace(/\s+/g, ' ').trim(), props })
  }
  return found
}

/** Set in capitals on purpose, and not labels: titles, the cover, and the Changelog's Claude Code groups. */
const NOT_LABELS = new Set([
  '.lc-screen__title',
  '.lc-lockup__name',
  '.lc-cover .lc-cover__claim',
  '.lc-release__label'
])

describe('a small capitalised label', () => {
  it('is the mono label: its size and its tracking come from the label tokens', () => {
    const off = rules(shell)
      .filter((rule) => rule.props['text-transform'] === 'uppercase' && !NOT_LABELS.has(rule.selector))
      .filter(
        (rule) =>
          rule.props['font-size'] !== 'var(--lc-text-mono-label)' ||
          !['var(--lc-tracking-label)', 'var(--lc-tracking-label-wide)'].includes(rule.props['letter-spacing'] ?? '')
      )
      .map((rule) => `${rule.selector}: ${rule.props['font-size'] ?? 'no size'}, ${rule.props['letter-spacing'] ?? 'no tracking'}`)
    expect(off).toEqual([])
  })
})

describe('a font size', () => {
  it('never names a colour token', () => {
    const colours = new Set(
      [...withoutComments(tokens).matchAll(/--(lc-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
        .filter((declaration) => /^(#|rgba?\(|hsla?\(|var\(--lc-(lime|amber|red|blue|green|violet|clay)\))/.test(declaration[2]!.trim()))
        .map((declaration) => declaration[1]!)
    )
    expect(colours.has('lc-text-muted')).toBe(true)
    const wrong = rules(shell)
      .filter((rule) => /var\(--(lc-[a-z0-9-]+)\)/.test(rule.props['font-size'] ?? ''))
      .filter((rule) => colours.has(/var\(--(lc-[a-z0-9-]+)\)/.exec(rule.props['font-size']!)![1]!))
      .map((rule) => `${rule.selector}: ${rule.props['font-size']!}`)
    expect(wrong).toEqual([])
  })
})
