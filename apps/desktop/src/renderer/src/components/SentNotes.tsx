import type { ReactElement } from 'react'

import { noteOutcome, noteOutcomeWords } from '../diffNotes.js'
import type { SentDiffNote } from '../diffNotes.js'
import type { DiffFile } from '../diff.js'
import { displayPath } from '../missionView.js'

/**
 * THE NOTES A MESSAGE CARRIED, AND WHAT BECAME OF EACH (0.395, Orca's #5).
 *
 * Under the person's bubble, the review notes it sent: where each was, the
 * line it was on, what was said -- and, once the teammate's turn is over,
 * whether that turn changed the line, only the file, or nothing there. The
 * notes stay put through the revision instead of dissolving into the
 * message's last paragraph.
 *
 * `edited` is undefined while the turn is still going: no outcome is said
 * about work that is not finished.
 */
export function SentNotes({ notes, edited, workspacePath }: { readonly notes: readonly SentDiffNote[]; readonly edited: readonly DiffFile[] | undefined; readonly workspacePath?: string | undefined }): ReactElement {
  return (
    <div className="lc-sentnotes" aria-label={`${String(notes.length)} ${notes.length === 1 ? 'note' : 'notes'} on the changes`}>
      {notes.map((note, index) => {
        const outcome = edited === undefined ? undefined : noteOutcome(note, edited)
        return (
          <div className="lc-sentnote" key={`${note.path}:${String(note.line ?? '')}:${String(index)}`}>
            <div className="lc-sentnote__head">
              <span className="lc-sentnote__place lc-mono" title={note.path}>
                {displayPath(note.path, workspacePath)}
                {note.line === undefined ? '' : `:${String(note.line)}`}
              </span>
              {outcome !== undefined && (
                <span className={`lc-sentnote__outcome is-${outcome}`}>{noteOutcomeWords(outcome)}</span>
              )}
            </div>
            {note.code !== undefined && note.code.length > 0 && <code className="lc-sentnote__code">{note.code}</code>}
            <span className="lc-sentnote__text">{note.text}</span>
          </div>
        )
      })}
    </div>
  )
}
