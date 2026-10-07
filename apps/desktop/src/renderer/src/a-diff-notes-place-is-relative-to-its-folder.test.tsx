import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DiffNotesContext } from './components/DiffNotes.js'
import { DiffView } from './components/DiffView.js'
import { SentNotes } from './components/SentNotes.js'
import { parseUnifiedDiff } from './diff.js'
import { diffNoteFor, splitDiffNotes, withDiffNotes } from './diffNotes.js'

const folder = 'C:\\work\\project'
const path = `${folder}\\src\\app.js`
const file = { ...parseUnifiedDiff('--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-const port = 3000\n+const port = 3001')[0]!, path }
const note = diffNoteFor(path, file.hunks[0]!.rows.find(row => row.kind === 'add')!, 'Use PORT.')

describe('a review note names its place in the folder', () => {
  it('labels the note button by the relative file, while retaining the original path for its note', () => {
    const html = renderToStaticMarkup(
      <DiffNotesContext.Provider value={{ notes: [note], add: () => undefined, remove: () => undefined, who: 'Builder' }}>
        <DiffView file={file} truncated={false} reported={undefined} workspacePath={folder} />
      </DiffNotesContext.Provider>
    )
    expect(html).toContain('aria-label="Add a note on src/app.js, line 1"')
    expect(html).toContain('lc-diff__row is-add has-note')
    expect(note.path).toBe(path)
  })

  it('shows the sent note relative to its folder, with the full path on hover and in the message', () => {
    const message = withDiffNotes('Please revise.', [note])
    const html = renderToStaticMarkup(<SentNotes notes={splitDiffNotes(message).notes} edited={undefined} workspacePath={folder} />)
    expect(html).toContain(`title="${path}"`)
    expect(html).toContain('>src/app.js:1</span>')
    expect(message).toContain(path)
  })

  it('keeps a relative name unchanged and does not treat another folder as this one', () => {
    for (const [requested, shown] of [['src/app.js', 'src/app.js'], ['C:\\work\\other\\src\\app.js', '…/src/app.js']]) {
      const entry = { ...splitDiffNotes(withDiffNotes('', [note])).notes[0]!, path: requested! }
      const html = renderToStaticMarkup(<SentNotes notes={[entry]} edited={undefined} workspacePath={folder} />)
      expect(html).toContain(`>${shown}:1</span>`)
      expect(html).toContain(`title="${requested}"`)
    }
  })

  it('still evaluates a revision against the stored absolute note path', () => {
    const notes = splitDiffNotes(withDiffNotes('', [note])).notes
    const html = renderToStaticMarkup(<SentNotes notes={notes} edited={[file]} workspacePath={folder} />)
    expect(html).toContain('>src/app.js:1</span>')
    expect(html).toContain('Line changed')
    expect(notes[0]!.path).toBe(path)
  })
})
