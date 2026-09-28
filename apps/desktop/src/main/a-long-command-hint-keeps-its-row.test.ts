import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { HIDDEN_COMMANDS } from './runtime-commands.js'

/**
 * A LONG HINT NEVER SQUEEZES ITS ROW (0.432).
 *
 * Colin, 2026-09-28, with a picture of the / menu: "some of these bugged".
 * A Claude Code command's hint ran to the 80 characters Locust allows, the
 * name column had `flex: none`, and the description beside it was left a
 * sliver -- one word per line. The row is one line now, as in Claude Code's
 * own menu: the name keeps its width, the hint and the description give way
 * with an ellipsis, and the whole text is the row's title.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const composer = readFileSync(fileURLToPath(new URL('../renderer/src/components/Composer.tsx', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const at = shell.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return shell.slice(at, shell.indexOf('}', at))
}

describe('a row of the / menu', () => {
  it('gives the name at most part of the row, never all of it', () => {
    const name = rule('.lc-slash__name')
    expect(name).not.toMatch(/flex: none/)
    expect(name).toMatch(/max-width: \d+%/)
    expect(name).toMatch(/overflow: hidden/)
  })

  it('cuts a long hint and a long description short, on one line', () => {
    for (const selector of ['.lc-slash__hint', '.lc-slash__detail']) {
      const body = rule(selector)
      expect(body, selector).toMatch(/text-overflow: ellipsis/)
      expect(body, selector).toMatch(/min-width: 0/)
    }
    expect(rule('.lc-slash__detail')).toMatch(/white-space: nowrap/)
  })

  it('says the whole of it on hover', () => {
    expect(composer).toMatch(/title=\{`\/\$\{command\.name\}/)
  })

  it("does not offer /auto-mode-setup, which changes Claude Code's own settings", () => {
    expect(HIDDEN_COMMANDS.claude?.has('auto-mode-setup')).toBe(true)
  })
})
