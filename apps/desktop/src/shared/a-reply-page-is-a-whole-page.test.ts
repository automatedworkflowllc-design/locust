import { describe, expect, it } from 'vitest'

import { isWholePage, MAX_REPLY_PAGE_CHARS } from './reply-page.js'

/*
 * Only a WHOLE page runs on a stage (0.553): a fragment of markup, a CSS or
 * JavaScript block, or a page still being written stays code.
 */
const PAGE = '<!DOCTYPE html>\n<html><body><canvas></canvas></body></html>'

describe('a reply\'s code block runs as a page only when it is a whole one', () => {
  it('a doctype or <html> at the start and </html> at the end', () => {
    expect(isWholePage(PAGE, 'html')).toBe(true)
    expect(isWholePage('<html lang="en"><body>hi</body></html>\n', 'HTML')).toBe(true)
    expect(isWholePage(PAGE, undefined)).toBe(true)
  })

  it('not a fragment, and not one cut off', () => {
    expect(isWholePage('<div class="card">hi</div>', 'html')).toBe(false)
    expect(isWholePage('<!DOCTYPE html>\n<html><body><canvas>', 'html')).toBe(false)
  })

  it('not another language that happens to hold markup', () => {
    expect(isWholePage(PAGE, 'js')).toBe(false)
    expect(isWholePage(PAGE, 'markdown')).toBe(false)
  })

  it('not past the size a page in a reply may be', () => {
    const huge = '<!DOCTYPE html><html><body>' + 'x'.repeat(MAX_REPLY_PAGE_CHARS) + '</body></html>'
    expect(isWholePage(huge, 'html')).toBe(false)
  })
})
