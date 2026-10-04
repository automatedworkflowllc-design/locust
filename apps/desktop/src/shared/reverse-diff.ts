/**
 * PUTTING A FILE BACK (0.502): the later turns' recorded changes, undone.
 *
 * Editing an earlier message sets the replies after it aside, and Colin asked
 * whether the files they changed should go back too (2026-09-30: "what do you
 * think?"). Only where it can be EXACT: the recorded change of each later
 * turn is reversed, newest first, on the file's text as it is now, and every
 * hunk must find its lines exactly where the record says they are -- no
 * fuzzy matching, no guessing at an offset. A patch that arrived cut short, an
 * edit reported with no diff, a rename, or a file someone changed since: the
 * file is left as it is, and the reason is given. A wrong file that looks
 * right is the worst outcome this could have (FileViewer.tsx says the same of
 * rebuilding old versions), so refusing is always the cheap side.
 *
 * Structurally the renderer's `DiffFile` (renderer/src/diff.ts); kept here so
 * the host, which does the writing, needs nothing of the window's.
 */

export interface ReverseRow {
  readonly kind: 'context' | 'add' | 'del'
  readonly text: string
}
export interface ReverseHunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly rows: readonly ReverseRow[]
}
export interface ReverseChange {
  readonly status: 'MODIFIED' | 'ADDED' | 'DELETED' | 'RENAMED'
  readonly hunks: readonly ReverseHunk[]
}

/** What the file should become: its text, or `null` for a file the turns created. */
export type Reversed = { readonly ok: true; readonly next: string | null } | { readonly ok: false; readonly why: string }

const CHANGED_SINCE = 'it was changed after those replies'

/** One change undone on `content` (`undefined`: the file is not there). */
export function reverseChange(content: string | undefined, change: ReverseChange): Reversed {
  if (change.status === 'RENAMED') return { ok: false, why: 'it was renamed, and a rename is not undone here' }
  for (const hunk of change.hunks) {
    const olds = hunk.rows.filter((row) => row.kind !== 'add').length
    const news = hunk.rows.filter((row) => row.kind !== 'del').length
    if (olds !== hunk.oldCount || news !== hunk.newCount) return { ok: false, why: 'its recorded change is incomplete' }
  }
  if (change.hunks.length === 0) return { ok: false, why: 'its change was recorded without the lines' }
  const eol = content !== undefined && content.includes('\r\n') ? '\r\n' : '\n'
  const bare = (line: string): string => line.replace(/\r$/, '')

  if (change.status === 'ADDED') {
    // Created by the turn: undone by removing it, only if it is exactly what was created.
    if (content === undefined) return { ok: true, next: null }
    const made = change.hunks.flatMap((hunk) => hunk.rows.filter((row) => row.kind === 'add').map((row) => bare(row.text)))
    const now = content.split('\n').map(bare)
    if (now.length > 0 && now[now.length - 1] === '') now.pop()
    return now.length === made.length && now.every((line, index) => line === made[index])
      ? { ok: true, next: null }
      : { ok: false, why: CHANGED_SINCE }
  }
  if (change.status === 'DELETED') {
    // Deleted by the turn: brought back only from a record of the whole file.
    if (content !== undefined) return { ok: false, why: CHANGED_SINCE }
    const hunk = change.hunks[0]
    if (change.hunks.length !== 1 || hunk === undefined || hunk.oldStart !== 1 || hunk.newCount !== 0) return { ok: false, why: 'its recorded change does not hold the whole file' }
    return { ok: true, next: `${hunk.rows.map((row) => bare(row.text)).join('\n')}\n` }
  }

  if (content === undefined) return { ok: false, why: 'it is not there any more' }
  const lines = content.split('\n').map(bare)
  const endsWithNewline = lines.length > 0 && lines[lines.length - 1] === ''
  if (endsWithNewline) lines.pop()
  // Bottom hunk first, so the line numbers above it still hold.
  const hunks = [...change.hunks].sort((left, right) => right.newStart - left.newStart)
  for (const hunk of hunks) {
    const after = hunk.rows.filter((row) => row.kind !== 'del').map((row) => bare(row.text))
    const before = hunk.rows.filter((row) => row.kind !== 'add').map((row) => bare(row.text))
    // "@@ -a,b +0,0 @@" empties the file; otherwise the new side starts at newStart.
    const at = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1
    if (at < 0 || at + after.length > lines.length) return { ok: false, why: CHANGED_SINCE }
    for (let index = 0; index < after.length; index += 1) {
      if (lines[at + index] !== after[index]) return { ok: false, why: CHANGED_SINCE }
    }
    lines.splice(at, after.length, ...before)
  }
  return { ok: true, next: `${lines.join(eol)}${endsWithNewline ? eol : ''}` }
}

/** Several turns' changes to one file, OLDEST first as recorded; undone newest first. */
export function reverseChanges(content: string | undefined, changes: readonly ReverseChange[]): Reversed {
  let now: string | undefined = content
  for (const change of [...changes].reverse()) {
    const step = reverseChange(now, change)
    if (!step.ok) return step
    now = step.next ?? undefined
  }
  return { ok: true, next: now ?? null }
}
