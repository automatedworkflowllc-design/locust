import type { DiffRow } from './diff.js'

/**
 * NOTES ON A DIFF, SENT AS ONE MESSAGE (0.376).
 *
 * Reviewing a teammate's change meant retyping what you were looking at --
 * "in app.ts, the line with the port" -- one message per thought, and each
 * message set the teammate off before the next arrived. Orca pins a note to
 * a line and sends them all at once, because one at a time "causes the agent
 * to swing back and forth"; Vibe Kanban does the same
 * (docs/RESEARCH-2026-09-26-ROOMS-AND-PEERS.md, item 5).
 *
 * So a "+" on a line of the diff pins a note there; the notes wait as one
 * tile in the chat box, the way an attached file does; and the next message
 * carries them all, each with its file, its line and the line itself, so the
 * teammate reads exactly what the person was looking at.
 */

export interface DiffNote {
  /** Which line of which file, stable across renders (`diffNoteKey`). */
  readonly key: string
  readonly path: string
  /** The line number a person reads: the new file's, or the old one's for a removed line. */
  readonly line: number | undefined
  readonly kind: DiffRow['kind']
  /** The line's code, as the diff showed it. */
  readonly code: string
  /** What the person wrote. */
  readonly text: string
}

/** The most a note's own text may be: a thought, not a document. */
export const MAX_DIFF_NOTE = 1_000
/** The most a quoted line of code carries into the message. */
const QUOTED_CODE = 160

export function diffNoteKey(path: string, row: Pick<DiffRow, 'kind' | 'oldNo' | 'newNo'>): string {
  return `${path}:${row.kind}:${String(row.oldNo ?? '')}:${String(row.newNo ?? '')}`
}

export function diffNoteFor(path: string, row: DiffRow, text: string): DiffNote {
  return {
    key: diffNoteKey(path, row),
    path,
    line: row.kind === 'del' ? row.oldNo : row.newNo ?? row.oldNo,
    kind: row.kind,
    code: row.text,
    text: text.trim().slice(0, MAX_DIFF_NOTE)
  }
}

/** Where a note is, as a person says it: "src/app.ts, line 12" or "..., removed line 12". */
export function diffNotePlace(note: Pick<DiffNote, 'path' | 'line' | 'kind'>): string {
  const line = note.line === undefined ? '' : `, ${note.kind === 'del' ? 'removed line' : 'line'} ${String(note.line)}`
  return `${note.path}${line}`
}

/**
 * The notes as the message carries them: in file order, then line order,
 * each with the line it is about. One block, after the person's own words.
 */
export function diffNotesBlock(notes: readonly DiffNote[]): string {
  if (notes.length === 0) return ''
  const ordered = [...notes].sort((a, b) => (a.path === b.path ? (a.line ?? 0) - (b.line ?? 0) : a.path.localeCompare(b.path)))
  const lines = ordered.map((note) => {
    const code = note.code.trim().replace(/\s+/g, ' ')
    const quoted = code.length === 0 ? '' : ` \`${code.length > QUOTED_CODE ? `${code.slice(0, QUOTED_CODE - 1)}…` : code}\``
    return `- ${diffNotePlace(note)}${quoted}: ${note.text.replace(/\s+/g, ' ').trim()}`
  })
  return [`Notes on your changes (${String(notes.length)}):`, ...lines].join('\n')
}

/** The message with its notes: the person's words first, then the block. */
export function withDiffNotes(text: string, notes: readonly DiffNote[]): string {
  const block = diffNotesBlock(notes)
  if (block.length === 0) return text
  return text.trim().length === 0 ? block : `${text.trimEnd()}\n\n${block}`
}

/** Add a note, or replace the one already on that line. */
export function withNote(notes: readonly DiffNote[], note: DiffNote): readonly DiffNote[] {
  return [...notes.filter((existing) => existing.key !== note.key), note]
}

/** The chat box's tile for them: "1 note on the changes", "3 notes on the changes". */
export function diffNotesTile(count: number): string {
  return count === 1 ? '1 note on the changes' : `${String(count)} notes on the changes`
}
