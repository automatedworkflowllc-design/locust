import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A LONG DIFF LINE WRAPS (0.422).
 *
 * Fresh-eyes area 25: a new index.html with long paragraph lines drew one
 * small scrollbar per line, each hiding the end of its sentence -- every code
 * cell scrolled on its own. drive-a-page-and-a-design counts code cells that
 * scroll sideways on the packaged build.
 */
const css = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`)
  return at === -1 ? '' : css.slice(at, css.indexOf('}', at))
}

describe('a line of a diff', () => {
  it('wraps rather than scrolling on its own', () => {
    const code = rule('.lc-diff__code')
    expect(code).toContain('white-space: pre-wrap;')
    expect(code).toContain('overflow-wrap: anywhere;')
    expect(code).not.toContain('overflow-x: auto')
  })

  it('in a column that may be narrower than its longest word', () => {
    expect(rule('.lc-diff__row')).toContain('grid-template-columns: 44px 44px 18px minmax(0, 1fr);')
  })
})
