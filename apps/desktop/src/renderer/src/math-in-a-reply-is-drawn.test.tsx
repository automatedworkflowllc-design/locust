import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { parseAgentText, segmentsCoverInput, splitInlineCode } from './agentText.js'
import { MathTex } from './components/MathTex.js'

/**
 * MATH IN A REPLY IS DRAWN (a tester's math homework, 2026-09-29).
 * The reply below is the shape of the one that reached his thread as raw LaTeX.
 */
const REPLY = [
  'Write $c_1(3,1,0)+c_2(2,0,3)+c_3(1,0,0) = (3c_1+2c_2+c_3,\\ c_1,\\ 3c_2)$. For a target vector $(x,y,z)$ this gives $c_1=y$.',
  '',
  '$$[\\mathrm{Id}]^\\beta_{\\beta\'}=\\begin{pmatrix}2&3&-1\\\\0&\\tfrac13&0\\\\-5&-\\tfrac{29}{3}&2\\end{pmatrix}$$',
  '',
  'Write $x^k=\\big((x+1)-1\\big)^k$ and expand with the binomial theorem:',
  '',
  '$$x^k=\\sum_{j=0}^{k}\\binom{k}{j}(-1)^{k-j}(x+1)^j.$$',
  '',
  'It costs $5 and the other costs $10, so $15 in all.'
].join('\n')

describe('math in a reply', () => {
  const blocks = parseAgentText(REPLY)

  it('draws each $$...$$ as a displayed equation, and loses no line', () => {
    const math = blocks.filter((block) => block.kind === 'math')
    expect(math).toHaveLength(2)
    expect(math[0]).toMatchObject({ tex: expect.stringContaining('\\begin{pmatrix}') })
    expect(math[1]).toMatchObject({ tex: expect.stringContaining('\\binom{k}{j}') })
    expect(segmentsCoverInput(REPLY, blocks)).toBe(true)
  })

  it('draws $...$ inside a sentence as inline math', () => {
    const spans = splitInlineCode('For a target vector $(x,y,z)$ this gives $c_1=y$ and \\(x^2\\).')
    expect(spans.filter((span) => span.kind === 'math').map((span) => span.text)).toEqual(['(x,y,z)', 'c_1=y', 'x^2'])
  })

  it('leaves money as money', () => {
    const spans = splitInlineCode('It costs $5 and the other costs $10, so $15 in all.')
    expect(spans.some((span) => span.kind === 'math')).toBe(false)
    expect(splitInlineCode('Between $5-$10 a month.').some((span) => span.kind === 'math')).toBe(false)
  })

  it('is drawn by KaTeX, and TeX it cannot read is shown as written', () => {
    expect(renderToStaticMarkup(<MathTex tex="c_1=y" display={false} />)).toContain('class="katex"')
    expect(renderToStaticMarkup(<MathTex tex="\\binom{k}{j}" display />)).toContain('katex-display')
    // throwOnError is off: an unknown command is drawn in red, never thrown.
    expect(() => renderToStaticMarkup(<MathTex tex="\\notacommand{x}" display={false} />)).not.toThrow()
  })

  it('never makes a link out of TeX', () => {
    expect(renderToStaticMarkup(<MathTex tex="\\href{https://evil.example}{x}" display={false} />)).not.toContain('<a ')
  })
})
