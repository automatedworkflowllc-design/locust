import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FileViewer } from './components/FileViewer.js'
import { isNewDocument } from './components/DocPreview.js'

/**
 * A WEB PAGE OPENS RUNNING, IN A FRAME OF ITS OWN (0.425).
 *
 * Colin, 2026-09-28: "full functionality, sacrifice nothing." The viewer
 * shows a page at its own address (main/page-preview.ts), its source a tab
 * away; the frame never gets top navigation. Without that address -- any
 * other file -- nothing runs (the-file-viewer-renders-and-never-runs).
 */
const noop = (): void => undefined
const PAGE = 'locust-page://0123456789abcdef01234567/site/index.html'

describe('the viewer', () => {
  it('runs a page in a sandboxed frame at its own address, with Page and Source', () => {
    const html = renderToStaticMarkup(
      <FileViewer path="C:/work/site/index.html" text="<h1>Corner Shop</h1>" mode="code" pageUrl={PAGE} onClose={noop} onReveal={noop} onSave={noop} />
    )
    expect(html).toContain(`src="${PAGE}"`)
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"')
    expect(html).not.toContain('allow-top-navigation')
    expect(html).toContain('>Page<')
    expect(html).toContain('>Source<')
    expect(html).toContain('cannot reach Locust, your files or your accounts')
  })

  it('runs nothing without a page address -- the same file shows as its source', () => {
    const html = renderToStaticMarkup(
      <FileViewer path="C:/work/site/index.html" text="<h1>Corner Shop</h1>" mode="code" onClose={noop} onReveal={noop} onSave={noop} />
    )
    expect(html).not.toContain('<iframe')
    expect(html).toContain('&lt;h1&gt;Corner Shop&lt;/h1&gt;')
  })
})

describe('the card of the turn that made it', () => {
  it('previews a new page, and only a new one', () => {
    const file = (status: string) => ({ path: 'C:/work/site/index.html', status, hunks: [] }) as never
    expect(isNewDocument(file('ADDED'))).toBe(true)
    expect(isNewDocument(file('MODIFIED'))).toBe(false)
  })
})
