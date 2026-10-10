import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { parseAgentText, segmentsCoverInput, splitInlineCode } from './agentText.js'
import { AgentText } from './components/ThreadItems.js'

/*
 * A QUOTED EQUATION IS DRAWN (a tester's linear algebra homework, 0.712,
 * 2026-10-09). Codex wrote the answer's "compact version you could write" as
 * a quote, with each displayed equation opened by `\[` on a line of its own.
 * The thread printed the quote as a plain paragraph -- the branch that drew
 * `> ` lines as a quote had gone in 64fce646 (0.233, 2026-09-21), and from then on
 * every quote was a paragraph -- and a paragraph never looks for a displayed
 * equation, so the tester read `\begin{bmatrix}` and `\sum_{k=1}^{n}` line
 * by line. The shape below is Codex's; the words are ours.
 */
const REPLY = [
  'Each entry of the product is a row of the first matrix times a column of the second.',
  '',
  '**A version you could write down:**',
  '',
  '> Let \\(M=\\begin{bmatrix}A&B\\\\C&D\\end{bmatrix}\\) and \\(N=\\begin{bmatrix}E&F\\\\G&H\\end{bmatrix}\\). For \\(1\\le i,j\\le n\\),',
  '> \\[',
  '> (MN)_{ij}',
  '> =',
  '> \\sum_{k=1}^{n}A_{ik}E_{kj}',
  '> +',
  '> \\sum_{k=1}^{n}B_{ik}G_{kj}',
  '> =',
  '> (AE+BG)_{ij}.',
  '> \\]',
  '> The other three blocks follow the same way, so',
  '> \\[',
  '> MN=',
  '> \\begin{bmatrix}',
  '> AE+BG&AF+BH\\\\',
  '> CE+DG&CF+DH',
  '> \\end{bmatrix}.',
  '> \\]'
].join('\n')

const drawn = (text: string): string => renderToStaticMarkup(<AgentText text={text} streaming={false} />)

describe('a quoted equation is drawn', () => {
  it('a quote is drawn as a quote, not as a paragraph', () => {
    const html = drawn('> Check the units before you divide.')
    expect(html).toContain('<blockquote class="lc-quote">')
    expect(html).toContain('Check the units before you divide.')
  })

  it('a displayed equation inside a quote is drawn by KaTeX, and none of its TeX is left showing', () => {
    const html = drawn(REPLY)
    expect(html).toContain('<blockquote class="lc-quote">')
    // Both of the quote's displayed equations, and the inline ones before them.
    expect(html.match(/katex-display/g) ?? []).toHaveLength(2)
    expect(html).not.toContain('\\begin{bmatrix}')
    expect(html).not.toContain('\\sum_{k=1}')
    expect(html).not.toContain('\\[')
    expect(html).not.toContain('\\]')
    // The words around the equations are still there.
    expect(html).toContain('The other three blocks follow the same way, so')
    expect(segmentsCoverInput(REPLY, parseAgentText(REPLY))).toBe(true)
  })

  it('a quote inside a quote, and a list inside a quote, keep their shape', () => {
    const html = drawn(['> Two things:', '> - the rows', '> - the columns', '> > and a note inside the note'].join('\n'))
    expect(html).toContain('<ul class="lc-list">')
    expect(html.match(/<blockquote class="lc-quote">/g) ?? []).toHaveLength(2)
  })

  it('an equation written in the middle of a line is drawn too', () => {
    // A list item's wrapped lines are joined into one, so `\[` lands mid-line there.
    const spans = splitInlineCode('So \\[ (AB)^T = B^T A^T \\] holds for any two, and $$x^2$$ too.')
    expect(spans.filter((span) => span.kind === 'math').map((span) => span.text)).toEqual(['(AB)^T = B^T A^T', 'x^2'])
    expect(spans.filter((span) => span.kind === 'math').every((span) => span.kind === 'math' && span.display === true)).toBe(true)
    const html = drawn(['1. The rule is', '   \\[ (AB)^T = B^T A^T \\]', '   for any two matrices.'].join('\n'))
    expect(html).toContain('katex-display')
    expect(html).not.toContain('\\[')
  })

  it('money and an escaped bracket in prose are still prose', () => {
    expect(splitInlineCode('It costs $5, or $$ if you upgrade.').some((span) => span.kind === 'math')).toBe(false)
    // Markdown's escaped brackets around a citation are not an equation.
    expect(splitInlineCode('As shown in \\[1\\] and \\[2\\], it holds.').some((span) => span.kind === 'math')).toBe(false)
    expect(splitInlineCode('See [the notes](notes.md) for more.').some((span) => span.kind === 'math')).toBe(false)
  })
})
