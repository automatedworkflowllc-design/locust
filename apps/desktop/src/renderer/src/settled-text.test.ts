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

  /*
   * Colin, 2026-10-02: a long table "takes a long time to adjust to format
   * because it only formats after the whole block sends". A table, a list and
   * headings have no blank line inside them, so each settles a line at a time.
   */
  describe('a table, a list and headings settle a line at a time', () => {
    it('settles a table from its rule on, row by finished row', () => {
      const text = join('Intro.', '', '| File | Why |', '|---|---|', '| a.ts | one |', '| b.ts | tw')
      const { settled, tail } = splitSettled(text)
      expect(settled).toBe(join('Intro.', '', '| File | Why |', '|---|---|', '| a.ts | one |'))
      expect(tail).toBe('| b.ts | tw')
    })

    it('holds a header row back until the rule under it has arrived', () => {
      // A header without its rule is still prose: settling it would draw pipes, then a table.
      expect(splitSettled(join('Intro.', '', '| File | Why |', '|---|')).settled).toBe('Intro.')
      expect(splitSettled(join('Intro.', '', '| File | Why |', '')).settled).toBe('Intro.')
    })

    it('settles a reply that opens with a table', () => {
      expect(splitSettled(join('| A | B |', '| - | - |', '| 1 | 2 |', '')).settled).toBe(join('| A | B |', '| - | - |', '| 1 | 2 |'))
    })

    it('settles each finished list item and heading, never the line still being written', () => {
      const text = join('## Findings', '- first, done', '- second, done', '1. third, done', '- fourth is still')
      const { settled, tail } = splitSettled(text)
      expect(settled).toBe(join('## Findings', '- first, done', '- second, done', '1. third, done'))
      expect(tail).toBe('- fourth is still')
    })

    it('stops at prose: a paragraph line still waits for its blank line', () => {
      const text = join('- an item', 'A sentence after it', 'that runs on')
      expect(splitSettled(text).settled).toBe('- an item')
    })

    it('settles the rows after a closed fence too', () => {
      const text = join(FENCE, 'x', FENCE, '- after the code', '- still writ')
      expect(splitSettled(text).settled).toBe(join(FENCE, 'x', FENCE, '- after the code'))
    })

    it('only moves forward as a table arrives a character at a time', () => {
      const whole = join('Intro.', '', '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '', 'After.')
      let previous = 0
      for (let at = 1; at <= whole.length; at += 1) {
        const { settled, tail } = splitSettled(whole.slice(0, at))
        expect(settled.length, JSON.stringify(whole.slice(0, at))).toBeGreaterThanOrEqual(previous)
        expect(settled.length === 0 ? tail : join(settled, tail)).toBe(whole.slice(0, at))
        previous = settled.length
      }
    })
  })
})
