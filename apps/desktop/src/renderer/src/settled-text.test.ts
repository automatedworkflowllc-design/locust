import { describe, expect, it } from 'vitest'

import { splitSettled } from './settledText.js'

/**
 * Text a person has read must not change shape after they read it.
 *
 * Colin, 2026-09-10: "glitchy". Every delta re-parsed the whole reply, so a
 * delta that closed a `*` or a fence reclassified text already on screen.
 * While streaming, only the settled prefix is parsed; the tail stays plain
 * until it settles.
 */

const NL = String.fromCharCode(10)
const FENCE = '```'
const join = (...lines: string[]): string => lines.join(NL)

describe('what has settled in a streaming reply', () => {
  it('settles a paragraph at the blank line that ends it, and not before', () => {
    const text = join('First paragraph, complete.', '', 'Second paragraph, still being writ')
    const { settled, tail } = splitSettled(text)
    expect(settled).toBe('First paragraph, complete.')
    expect(tail).toBe(join('', 'Second paragraph, still being writ'))
  })

  it('leaves everything as tail while the first paragraph is still arriving', () => {
    // Nothing has settled, so nothing is parsed: the reader has read nothing
    // yet that could change shape.
    const { settled, tail } = splitSettled('Worth flagging upfront: Alphabet is one of')
    expect(settled).toBe('')
    expect(tail).toBe('Worth flagging upfront: Alphabet is one of')
  })

  it('never splits an open fence, whatever blank lines it holds', () => {
    // Half a code block parsed as prose IS the reflow this exists to stop: the
    // opener would render as a paragraph reading three backticks, then flip
    // into a code block a delta later.
    const text = join('Here is the diff:', '', FENCE + 'ts', 'const a = 1', '', 'const b = 2')
    const { settled, tail } = splitSettled(text)
    expect(settled).toBe(join('Here is the diff:', ''))
    expect(tail.startsWith(FENCE + 'ts')).toBe(true)
    expect(tail).toContain('const b = 2')
  })

  it('settles a fence the moment it closes, blank line or not', () => {
    const text = join(FENCE, 'x', FENCE, 'And then prose that is still going')
    const { settled, tail } = splitSettled(text)
    expect(settled).toBe(join(FENCE, 'x', FENCE))
    expect(tail).toBe('And then prose that is still going')
  })

  it('loses nothing: settled plus tail is the text', () => {
    for (const text of [
      '',
      'one line',
      join('a', '', 'b', '', 'c'),
      join('p', '', FENCE, 'code', '', 'more', FENCE, '', 'after'),
      join('p', '', FENCE + 'js', 'unterminated')
    ]) {
      const { settled, tail } = splitSettled(text)
      const rejoined = settled.length === 0 ? tail : join(settled, tail)
      expect(rejoined, JSON.stringify(text)).toBe(text)
    }
  })

  it('only ever moves forward as text arrives', () => {
    // A prefix that has settled must stay settled as the reply grows: a
    // settled boundary that retreats is text un-formatting itself.
    const stages = [
      'Alpha.',
      join('Alpha.', ''),
      join('Alpha.', '', 'Beta'),
      join('Alpha.', '', 'Beta is longer now.'),
      join('Alpha.', '', 'Beta is longer now.', ''),
      join('Alpha.', '', 'Beta is longer now.', '', 'Gamma')
    ]
    let previous = 0
    for (const stage of stages) {
      const { settled } = splitSettled(stage)
      expect(settled.length, stage).toBeGreaterThanOrEqual(previous)
      previous = settled.length
    }
  })
})
