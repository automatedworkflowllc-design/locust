import { describe, expect, it } from 'vitest'

import { splitInlineCode } from './agentText.js'
import { isOutboundLink, isWebLink, linkHost } from '../../shared/outbound-links.js'

/**
 * Links in a reply are read as links, and the web ones go somewhere.
 *
 * Colin, 2026-09-14, with a screenshot of a Cursor reply and two questions:
 * "light structuring bug in the text, also do we have clickable links yet?"
 * and then "source links are hoverable but not clickable".
 *
 * TWO defects, one visible and one deliberate.
 *
 * The visible one: the reply contained
 * `*[We Must Pace the Frontier](https://darioamodei.com/post/...)*` -- an
 * italicised article title that is also the link, which models write
 * constantly. The scan finds the earliest match and `*` comes before `[`, so
 * emphasis won and swallowed the whole link as its text; emphasis text is not
 * parsed again, so the brackets and the raw URL rendered in the middle of the
 * sentence.
 *
 * The deliberate one: nothing was ever clickable. The note explaining that
 * said an actionable link is what a prompt injection would ask for -- the
 * right instinct about the wrong risk. A reply is rendered as TEXT and never
 * as markup, so nothing here executes. What a model can do is write a label
 * that disagrees with its target, and the answer to that is to SHOW the
 * destination, not to break every honest citation.
 */

describe('a link inside emphasis', () => {
  it('is a link, not four asterisks and a URL', () => {
    const spans = splitInlineCode(
      'Amodei published *[We Must Pace the Frontier](https://darioamodei.com/post/we-must-pace-the-frontier)*: slow growth.'
    )
    const link = spans.find((span) => span.kind === 'link')
    expect(link).toEqual({
      kind: 'link',
      text: 'We Must Pace the Frontier',
      href: 'https://darioamodei.com/post/we-must-pace-the-frontier'
    })
    // And nothing anywhere still shows the syntax.
    expect(spans.map((span) => span.text).join('')).not.toContain('](')
  })

  it('works for bold as well as italic', () => {
    for (const wrap of ['**', '__', '*', '_']) {
      const spans = splitInlineCode(`see ${wrap}[the essay](https://example.com/x)${wrap} for more`)
      expect(spans.find((span) => span.kind === 'link')).toMatchObject({ text: 'the essay' })
    }
  })

  it('leaves a plain link and plain emphasis exactly as they were', () => {
    expect(splitInlineCode('[label](https://example.com)').find((s) => s.kind === 'link')).toMatchObject({
      text: 'label',
      href: 'https://example.com'
    })
    expect(splitInlineCode('this is **bold** here').find((s) => s.kind === 'strong')).toMatchObject({
      text: 'bold'
    })
    // The case that has to keep working: an underscore inside a name.
    expect(splitInlineCode('snake_case_name').every((s) => s.kind === 'plain')).toBe(true)
  })

  it('keeps a code span literal even when it looks like a link', () => {
    const spans = splitInlineCode('run `[x](y)` first')
    expect(spans.find((span) => span.kind === 'code')).toMatchObject({ text: '[x](y)' })
    expect(spans.some((span) => span.kind === 'link')).toBe(false)
  })
})

describe('which links may be opened', () => {
  it('accepts an ordinary web address', () => {
    expect(isWebLink('https://darioamodei.com/post/we-must-pace-the-frontier')).toBe(true)
    expect(isWebLink('http://example.com')).toBe(true)
  })

  it('refuses every way of reaching this machine', () => {
    // The original policy's actual concern, and it survives intact.
    expect(isWebLink('file:///C:/Users/<home>/.ssh/id_rsa')).toBe(false)
    expect(isWebLink('vscode://file/C:/secret')).toBe(false)
    expect(isWebLink('javascript:alert(1)')).toBe(false)
    expect(isWebLink('data:text/html,<script>')).toBe(false)
    expect(isWebLink('C:/Users/<home>/streaks/src/streak.test.js')).toBe(false)
    expect(isWebLink('mailto:someone@example.com')).toBe(false)
    expect(isWebLink('https://')).toBe(false)
    expect(isWebLink(undefined)).toBe(false)
    expect(isWebLink(`https://example.com/${'x'.repeat(3000)}`)).toBe(false)
  })

  it('still opens the three addresses the app itself links to', () => {
    // Unchanged by the widening: these are the app's own, chosen in the host.
    expect(isOutboundLink('https://nodejs.org')).toBe(true)
    expect(isOutboundLink('https://example.com')).toBe(false)
  })

  it('names where a link actually goes, so a label cannot lie about it', () => {
    expect(linkHost('https://darioamodei.com/post/x')).toBe('darioamodei.com')
    expect(linkHost('https://www.reuters.com/article')).toBe('reuters.com')
    // A local path has no host, which is exactly how the renderer knows not
    // to make it clickable.
    expect(linkHost('C:/Users/<home>/notes.md')).toBeUndefined()
  })
})
