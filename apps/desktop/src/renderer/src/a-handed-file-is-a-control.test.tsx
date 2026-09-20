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

/**
 * And the second thing a person wants from a file: it somewhere else.
 *
 * Colin, 2026-09-20, looking at a real handover: "give it the little download
 * icon that claude code also has for files, in case the user wants to easily
 * move it to another folder."
 *
 * On a desktop app the file is already on disk, so this is a copy to a place
 * the person picks in a native save dialog rather than a download. It does
 * NOT weaken the rule above: bytes are copied, nothing is executed, and the
 * destination is never a path the renderer named.
 */
describe('saving a copy of a handed file', () => {
  it('offers it, beside the reveal rather than instead of it', () => {
    const html = drawn([item])
    expect(html).toContain('lc-handedfile__save')
    expect(html).toContain('Save a copy of docs/report.md')
    // Both actions, on one file.
    expect(html).toContain('lc-handedfile__open')
  })

  it('still never offers to open it', () => {
    // The rule this whole file exists for, re-checked now there are two
    // buttons: a save dialog is the person choosing a destination, which is
    // a different act from launching what a model wrote.
    const html = drawn([item])
    expect(html).not.toMatch(/>\s*Open\b/)
  })

  it('keeps the whole note reachable when the pill truncates it', () => {
    /*
     * The note is the teammate's own words and it ellipsises in a pill, so
     * the cut-off half has to live somewhere. It did not: the title said only
     * "Show <path> in the file manager", and Colin hit exactly that on a real
     * handover -- "evening continuation: workroom/relay/q…" with no way to
     * read the rest.
     */
    const html = drawn([item])
    expect(html).toContain('the rollup you asked for')
    expect(html).toMatch(/title="the rollup you asked for[^"]*Show docs\/report\.md/)
  })
})
