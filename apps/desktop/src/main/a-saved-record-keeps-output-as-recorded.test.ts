import { describe, expect, it } from 'vitest'

import { collapseOutsideFences } from './mission-export.js'

/**
 * A SAVED RECORD KEEPS A COMMAND'S OUTPUT AS RECORDED (the 2026-10-10 sweep). The record squeezes runs of blank
 * lines between its sections, and did it inside fenced output too, so "Output as recorded" was not.
 */
describe('blank lines in a saved record', () => {
  it('are squeezed between sections, and kept inside a fence', () => {
    const text = ['# Turn 1', '', '', '', 'Ran a command.', '```', 'line one', '', '', 'line four', '```', '', '', 'Done.'].join('\n')
    expect(collapseOutsideFences(text)).toBe(['# Turn 1', '', 'Ran a command.', '```', 'line one', '', '', 'line four', '```', '', 'Done.'].join('\n'))
  })

  it('reads a longer fence as one fence, whatever it holds', () => {
    const text = ['````', '```', '', '', '```', '````', '', '', 'after'].join('\n')
    expect(collapseOutsideFences(text)).toBe(['````', '```', '', '', '```', '````', '', 'after'].join('\n'))
  })
})
