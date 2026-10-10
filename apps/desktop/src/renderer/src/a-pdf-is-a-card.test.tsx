import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PdfPages } from './components/PdfPages.js'
import { PdfTile } from './components/PdfTile.js'
import { isPdf, pdfMeta } from './pdfPages.js'

/*
 * A PDF YOU ATTACHED IS A CARD, AND OPENS AS ITS PAGES (0.714). On 0.712 it
 * was a monospace chip of the path Locust copied it to; Codex's own app, in
 * the same tester's photo, drew the file as a file. The card shows the first
 * page Locust drew for the agent; the viewer shows every page.
 * drive-a-pdf-arrives-readable.mjs presses it in the running app.
 */
describe('a PDF in the chat', () => {
  it('is its name and its page count, never the path it was copied to', () => {
    const html = renderToStaticMarkup(<PdfTile path=".locust/attachments/Homework 5.pdf" folder="C:/work/ws" onOpen={() => undefined} />)
    expect(html).toContain('Homework 5.pdf')
    expect(html).not.toContain('.locust/attachments')
    // Before its pages are drawn it says only what it knows.
    expect(html).toContain('lc-pdftile__badge')
    expect(html).toContain('>PDF<')
  })

  it('says how many pages, in one word or two', () => {
    expect(pdfMeta(undefined)).toBe('PDF')
    expect(pdfMeta(1)).toBe('PDF · 1 page')
    expect(pdfMeta(12)).toBe('PDF · 12 pages')
    expect(isPdf('notes/Report.PDF')).toBe(true)
    expect(isPdf('notes/report.pdf.txt')).toBe(false)
  })
})

describe('a PDF in the viewer', () => {
  it('a page each, numbered, and the pages it did not draw said rather than left out', () => {
    const pictures = ['.locust/attachments/Book.pdf-pages/page-01.png', '.locust/attachments/Book.pdf-pages/page-02.png']
    const html = renderToStaticMarkup(<PdfPages name="Book.pdf" pages={40} pictures={pictures} folder="C:/work/ws" />)
    expect(html.match(/lc-pdfpages__page/g) ?? []).toHaveLength(2)
    expect(html).toContain('1 of 40')
    expect(html).toContain('2 of 40')
    expect(html).toContain('Locust drew the first 2 of its 40 pages.')
  })

  it('a PDF drawn whole says nothing more', () => {
    const html = renderToStaticMarkup(<PdfPages name="Sheet.pdf" pages={1} pictures={['a/page-01.png']} folder="C:/work/ws" />)
    expect(html).toContain('1 of 1')
    expect(html).not.toContain('lc-pdfpages__more')
  })
})
