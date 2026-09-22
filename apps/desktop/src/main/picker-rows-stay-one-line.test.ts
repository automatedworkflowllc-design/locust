import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The picker's rows are DRAWN to stay one line -- the half of
 * `a-model-is-one-line.test.tsx` that markup cannot show. A detail line that
 * wraps is the three-line row the change removed.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}

describe("the picker's rows", () => {
  it('put the name and the detail side by side', () => {
    expect(rule('.lc-picker__text')).not.toContain('flex-direction: column')
  })

  it('cut the detail short instead of wrapping it', () => {
    const detail = rule('.lc-picker__detail')
    expect(detail).toContain('white-space: nowrap')
    expect(detail).toContain('text-overflow: ellipsis')
    expect(detail).toContain('min-width: 0')
  })

  it('never let a long name push the detail off the row', () => {
    const label = rule('.lc-picker__label')
    expect(label).toContain('max-width')
    expect(label).toContain('text-overflow: ellipsis')
  })
})
