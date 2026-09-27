import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SentNotes } from './components/SentNotes.js'
import { parseUnifiedDiff } from './diff.js'
import { noteOutcome, splitDiffNotes, withDiffNotes } from './diffNotes.js'
import type { DiffNote } from './diffNotes.js'

/**
 * REVIEW NOTES SURVIVE A REVISION (0.395, Orca's #5).
 *
 * A note pinned to a line of a teammate's diff went with the next message as
 * a paragraph and was never seen again: the bubble printed it raw, and nothing
 * said whether the teammate's revision touched the line. Now the sent notes
 * are read back out of the message and held against that turn's own changes.
 */
const note = (path: string, line: number, code: string, text: string, kind: DiffNote['kind'] = 'add'): DiffNote => ({ key: `${path}:${String(line)}`, path, line, kind, code, text })
const SENT = withDiffNotes('Tidy these up, please.', [
  note('src/app.ts', 12, 'const port = 3000', 'Read the port from the environment.'),
  note('src/app.ts', 40, 'log(everything)', 'Too noisy.'),
  note('README.md', 3, 'Run it with npm', 'Say pnpm.'),
  note('src/old.ts', 7, 'legacy()', 'Is this still called?', 'del')
])

describe('the notes a message carried', () => {
  it("are read back out of it, the person's own words apart", () => {
    const { text, notes } = splitDiffNotes(SENT)
    expect(text).toBe('Tidy these up, please.')
    expect(notes.map((entry) => [entry.path, entry.line, entry.removed, entry.code, entry.text])).toEqual([
      ['README.md', 3, false, 'Run it with npm', 'Say pnpm.'],
      ['src/app.ts', 12, false, 'const port = 3000', 'Read the port from the environment.'],
      ['src/app.ts', 40, false, 'log(everything)', 'Too noisy.'],
      ['src/old.ts', 7, true, 'legacy()', 'Is this still called?']
    ])
  })

  it('leave a message with no notes exactly as it was', () => {
    expect(splitDiffNotes('Just words. Notes on your changes are welcome.')).toEqual({ text: 'Just words. Notes on your changes are welcome.', notes: [] })
  })
})

// The revision: app.ts line 12 rewritten, line 40 untouched but the file
// changed; README.md not touched; old.ts deleted.
const REVISION = parseUnifiedDiff([
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -11,3 +11,3 @@',
  ' import { env } from "./env"',
  '-const port = 3000',
  '+const port = Number(env.PORT ?? 3000)',
  ' serve(port)',
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-legacy()',
  ''
].join('\n'))

describe('what became of each note in the revision', () => {
  const notes = splitDiffNotes(SENT).notes
  it('says the line changed, only the file changed, nothing changed, or the file went', () => {
    expect(notes.map((entry) => noteOutcome(entry, REVISION))).toEqual(['untouched', 'line', 'file', 'deleted'])
  })

  it('finds the file however the runtime wrote its path', () => {
    const absolute = REVISION.map((file) => ({ ...file, path: `C:\\work\\${file.path.replace(/\//g, '\\')}` }))
    expect(noteOutcome(notes[1]!, absolute)).toBe('line')
  })

  it('are drawn under the bubble, each with where it was and what became of it once the turn is over', () => {
    const done = renderToStaticMarkup(<SentNotes notes={notes} edited={REVISION} />)
    expect(done).toContain('src/app.ts:12')
    expect(done).toContain('<span class="lc-sentnote__outcome is-line">Line changed</span>')
    expect(done).toContain('File changed, not this line')
    expect(done).toContain('Not changed')
    expect(done).toContain('File deleted')
    expect(done).toContain('Read the port from the environment.')
    const going = renderToStaticMarkup(<SentNotes notes={notes} edited={undefined} />)
    expect(going).not.toContain('lc-sentnote__outcome')
  })
})
