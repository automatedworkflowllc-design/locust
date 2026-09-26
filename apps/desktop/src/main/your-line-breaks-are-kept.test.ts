import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * YOUR LINE BREAKS ARE KEPT (0.376).
 *
 * The conversation's bubble collapsed every line break, so a message typed
 * over several lines -- or notes on a diff, one to a line -- read as one run-on
 * paragraph (drive-diff-notes). A room's post has kept them all along; the
 * two bubbles now say the person's words the same way.
 */
const css = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  // The rule that starts a line: a longer selector can end in the same words.
  const at = css.indexOf(`
${selector} {`)
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at))
}

describe('the person’s own words', () => {
  it('keep their line breaks in a conversation, as in a room', () => {
    expect(rule('.lc-bubble')).toContain('white-space: pre-line')
    expect(rule('.lc-roompost__you')).toContain('white-space: pre-line')
  })
})
