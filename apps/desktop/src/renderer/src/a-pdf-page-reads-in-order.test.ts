import { describe, expect, it } from 'vitest'

import { pageText } from './pdfText.js'

/*
 * A PDF PAGE READS IN ORDER (0.713): pdf.js gives a page's text as runs with
 * where each was drawn; pdfText.ts puts them back on their lines, so the text
 * Locust writes beside an attached PDF keeps a matrix's rows and entries apart
 * (main/a-pdf-arrives-readable.test.ts holds the rest).
 */
describe('a page’s text, in reading order', () => {
  const run = (str: string, x: number, y: number, size = 10, width = str.length * size * 0.5) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size })

  it('puts runs on their lines, top first, and keeps a matrix’s entries apart', () => {
    const runs = [
      run('47', 150, 588, 12), run('2', 120, 588, 12), run('5', 90, 588, 12),
      run('Practice sheet', 72, 720, 18),
      run('3', 90, 610, 12), run('8', 120, 610, 12), run('1', 150, 610, 12)
    ]
    expect(pageText(runs)).toBe('Practice sheet\n3  8  1\n5  2  47')
  })

  it('a subscript joins its line, and the next line of a paragraph does not', () => {
    // "x" with a subscript "1" a little below it, then the next line 12 points down.
    const runs = [run('x', 72, 700, 10, 5), run('1', 77.5, 697, 7, 3.5), run(' = 4', 81, 700, 10, 18), run('next line', 72, 688, 10)]
    expect(pageText(runs)).toBe('x1 = 4\nnext line')
  })

  it('an empty page is no text, not an error', () => {
    expect(pageText([])).toBe('')
    expect(pageText([run('', 72, 700)])).toBe('')
  })
})

