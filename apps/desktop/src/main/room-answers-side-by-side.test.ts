import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * ANSWERS SIDE BY SIDE (0.399). A room's answers in columns, to read across.
 * Each column keeps a reading width and the row scrolls sideways rather than
 * squeezing three answers into slivers. Measured by
 * _tools/drive-room-round-two.mjs: two answers, one row, same top.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}

describe('answers side by side', () => {
  it('are one row that scrolls sideways', () => {
    const row = rule('.lc-roompost__answers.is-columns')
    expect(row).toContain('flex-direction: row')
    expect(row).toContain('overflow-x: auto')
  })

  it('keep a reading width each', () => {
    const column = rule('.lc-roompost__answers.is-columns > .lc-roomanswer')
    expect(column).toContain('min-width: 320px')
    expect(column).toContain('flex: 1 0 320px')
  })

  it('give an answer’s buttons a line of their own, together -- the first packaged drive found them broken in two around the route', () => {
    const group = rule('.lc-roomanswer__acts')
    expect(group).toContain('display: flex')
    expect(group).toContain('margin-left: auto')
    // A ghost button pushes itself right on its own; in the group it must not.
    expect(rule('.lc-roomanswer__acts .lc-ghostbutton')).toContain('margin-left: 0')
    expect(rule('.lc-roompost__answers.is-columns .lc-roomanswer__acts')).toContain('flex-basis: 100%')
  })

  it('build on the one-under-another column, which is flex', () => {
    expect(rule('.lc-roompost__answers')).toContain('display: flex')
  })
})
