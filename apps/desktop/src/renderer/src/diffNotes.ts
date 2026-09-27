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

/*
 * NOTES THAT SURVIVE A REVISION (0.395, Orca's #5).
 *
 * Sent, the notes were words at the end of the person's message and nothing
 * else: the bubble printed the block raw, and nothing said what became of a
 * note once the teammate revised. Orca keeps each review note on its line
 * through the agent's next pass and says whether that pass touched it. Here
 * the block is read back out of the sent message -- it is written by
 * `diffNotesBlock` above, so its shape is ours -- and each note is held
 * against what that turn went on to change.
 */
export interface SentDiffNote {
  readonly path: string
  readonly line: number | undefined
  /** It was on a line the earlier change had removed. */
  readonly removed: boolean
  readonly code: string | undefined
  readonly text: string
}

const BLOCK_HEAD = /(?:^|\n\n)Notes on your changes \((\d+)\):\n((?:- .*(?:\n|$))+)\s*$/
const NOTE_LINE = /^- (.+?)(?:, (removed line|line) (\d+))?(?: `([^`]*)`)?: (.*)$/

/** A sent message's own words, and the notes it carried, read back out of it. */
export function splitDiffNotes(text: string): { readonly text: string; readonly notes: readonly SentDiffNote[] } {
  const found = BLOCK_HEAD.exec(text)
  if (found === null) return { text, notes: [] }
  const notes: SentDiffNote[] = []
  for (const row of (found[2] ?? '').split('\n')) {
    const note = NOTE_LINE.exec(row.trim())
    if (note === null) continue
    notes.push({
      path: note[1]!,
      line: note[3] === undefined ? undefined : Number(note[3]),
      removed: note[2] === 'removed line',
      code: note[4],
      text: note[5]!.trim()
    })
  }
  if (notes.length === 0) return { text, notes: [] }
  return { text: text.slice(0, found.index).trimEnd(), notes }
}

/** What the turn that received a note went on to do where it was. */
export type NoteOutcome = 'line' | 'file' | 'untouched' | 'deleted'

/**
 * A note's line is the file as it was BEFORE the turn that read it, which is
 * the old side of that turn's own diff: a removed or rewritten row with that
 * old number is the line the note was on.
 */
export function noteOutcome(note: SentDiffNote, edited: readonly { readonly path: string; readonly status: string; readonly hunks: readonly { readonly rows: readonly { readonly kind: string; readonly oldNo?: number }[] }[] }[]): NoteOutcome {
  const key = (path: string): string => path.replace(/[\\/]+/g, '/').replace(/^\.\//, '').toLowerCase()
  const wanted = key(note.path)
  const file = edited.find((entry) => {
    const have = key(entry.path)
    return have === wanted || have.endsWith(`/${wanted}`) || wanted.endsWith(`/${have}`)
  })
  if (file === undefined) return 'untouched'
  if (file.status === 'DELETED') return 'deleted'
  if (note.line === undefined || note.removed) return 'file'
  const onTheLine = file.hunks.some((hunk) => hunk.rows.some((row) => row.kind === 'del' && row.oldNo === note.line))
  return onTheLine ? 'line' : 'file'
}

/** The chip a note wears once the turn is over. */
export function noteOutcomeWords(outcome: NoteOutcome): string {
  if (outcome === 'line') return 'Line changed'
  if (outcome === 'file') return 'File changed, not this line'
  if (outcome === 'deleted') return 'File deleted'
  return 'Not changed'
}

/** The chat box's tile for them: "1 note on the changes", "3 notes on the changes". */
export function diffNotesTile(count: number): string {
  return count === 1 ? '1 note on the changes' : `${String(count)} notes on the changes`
}
