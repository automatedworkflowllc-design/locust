import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import CARD from './components/ActivityCard.tsx?raw'
import { AgentText } from './components/ThreadItems.js'

/**
 * A NOTE BETWEEN STEPS RENDERS ITS CODE (0.421).
 *
 * Fresh-eyes area 23: fixing a cart bug, Nemotron wrote a note between its
 * steps with a fenced code block, and the steps panel showed "```javascript"
 * as text -- the note was drawn with inline code only, while the reply under
 * it used the full renderer. drive-a-coder-fixes-a-bug photographs the panel.
 */
const NOTE = 'Found the bug. In `cart.js:3`, the discount is subtracted as a flat amount:\n```javascript\nreturn subtotal - discountPercent\n```\nShould be a percentage.'

describe('the note between steps', () => {
  it('is drawn by the reply’s renderer', () => {
    // Since 0.491 a note between steps is not a row of the fold at all: it is
    // a message in the thread, between the step groups, drawn as the reply is.
    expect(CARD).not.toContain('lc-filerow--said')
    expect(CARD).not.toContain('splitInlineCode(entry.text)')
  })

  it('which turns a fenced block into code, with no fences left as text', () => {
    const html = renderToStaticMarkup(<AgentText text={NOTE} streaming={false} />)
    expect(html).toContain('<pre class="lc-code">')
    expect(html).toContain('return subtotal - discountPercent')
    expect(html).not.toContain('```')
  })
})
