import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ThreadItems } from './components/Thread.js'
import type { ThreadItem } from './missionView.js'

/**
 * What a handed file looks like on screen.
 *
 * The mirror of the person's own attachment row: a file arriving from a
 * teammate answers the same question a file the person sent does -- "where is
 * it" -- so it gets the same control, pointed the other way.
 *
 * REVEAL, NEVER OPEN, and this test pins it. The host refuses
 * `shell.openPath` on purpose: opening would RUN a `.bat` or a `.ps1` the
 * model had just written, and the model chooses both the name and the
 * contents. So the only thing a person can press here shows the file in their
 * file manager. If an Open button is ever added, this test is where the
 * reason it must not be lives.
 */

const item: ThreadItem = {
  key: 'files_1',
  type: 'files',
  files: [{ path: 'docs/report.md', note: 'the rollup you asked for' }]
}

const drawn = (items: readonly ThreadItem[]): string =>
  renderToStaticMarkup(
    <ThreadItems items={items} owner={undefined} activity="idle" workspacePath="C:\\work" decision={undefined} />
  )

describe('a file a teammate handed over', () => {
  it('names the file and says what it is', () => {
    const html = drawn([item])
    expect(html).toContain('docs/report.md')
    expect(html).toContain('the rollup you asked for')
  })

  it('is a control, not a sentence', () => {
    // The whole defect: Colin asked for a file and got a path as prose.
    const html = drawn([item])
    expect(html).toContain('lc-handedfile')
    expect(html).toContain('<button')
  })

  it('offers to show the file, and never to open it', () => {
    const html = drawn([item])
    expect(html).toContain('Show docs/report.md in the file manager')
    expect(html).not.toMatch(/>\s*Open\b/)
  })

  it('draws a file with no note without an empty caption beside it', () => {
    const html = drawn([{ key: 'files_2', type: 'files', files: [{ path: 'notes.md' }] }])
    expect(html).toContain('notes.md')
    expect(html).not.toContain('lc-handedfile__note')
  })
})
