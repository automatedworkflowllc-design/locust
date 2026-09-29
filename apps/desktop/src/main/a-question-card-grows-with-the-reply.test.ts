import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A QUESTION CARD GROWS WITH THE REPLY (QA-2026-09-29 round 2, N8). At the
 * Largest reply size the reply was 19px and the card a person must read to
 * decide stayed at 12px, as did their own message. CSS is read here, in main:
 * a renderer test's CSS import is empty.
 */
const renderer = join(__dirname, '..', 'renderer', 'src')
const tokens = readFileSync(join(renderer, 'tokens.css'), 'utf8')
const shell = readFileSync(join(renderer, 'shell.css'), 'utf8')

const block = (css: string, selector: string): string => {
  // At a line start: `.lc-thread__column > .lc-bubble {` also ends in the selector.
  const at = css.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}
const px = (text: string, token: string): number => Number(new RegExp(`${token}:\\s*([\\d.]+)px`).exec(text)?.[1])

describe('the reply size', () => {
  it('grows the card and the person\'s message at each step', () => {
    const large = block(tokens, ":root[data-replysize='large']")
    const largest = block(tokens, ":root[data-replysize='largest']")
    for (const token of ['--lc-text-said', '--lc-text-ask', '--lc-text-ask-foot']) {
      const standard = px(tokens, token)
      expect(standard, token).toBeGreaterThan(0)
      expect(px(large, token), token).toBeGreaterThan(standard)
      expect(px(largest, token), token).toBeGreaterThan(px(large, token))
    }
  })

  it('is what the card and the bubble are set in', () => {
    expect(block(shell, '.lc-decision__question')).toContain('var(--lc-text-ask)')
    expect(block(shell, '.lc-decision__note')).toContain('var(--lc-text-ask)')
    expect(block(shell, '.lc-decision__label')).toContain('var(--lc-text-said)')
    expect(block(shell, '.lc-decision__foot')).toContain('var(--lc-text-ask-foot)')
    expect(block(shell, '.lc-bubble')).toContain('var(--lc-text-said)')
  })
})
