/**
 * A unified diff, read into rows the thread can draw.
 *
 * Two rules from the design pass are enforced here rather than in review,
 * because both regressed by hand the first time the view was drawn:
 *
 * 1. Counts are DERIVED, never authored. A file's `+N −M`, every `@@` range,
 *    and the activity summary all come from the same row set. Three numbers
 *    describing one change must agree, or a reviewer trusts the wrong one.
 * 2. No open file ends in silence. It ends with `All N hunks shown`, an
 *    expand button, or a quantified remainder -- always one. Silence after
 *    the last row reads as "that was the whole change", which is the single
 *    worst thing this view can do.
 */

export type DiffRowKind = 'context' | 'add' | 'del'

export interface DiffRow {
  readonly kind: DiffRowKind
  readonly oldNo?: number
  readonly newNo?: number
  readonly text: string
}

export interface DiffHunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  /** Whatever followed the range on the `@@` line; usually a symbol. */
  readonly heading: string
  readonly rows: readonly DiffRow[]
}

export type DiffFileStatus = 'MODIFIED' | 'ADDED' | 'DELETED' | 'RENAMED'

export interface DiffFile {
  readonly path: string
  readonly status: DiffFileStatus
  readonly hunks: readonly DiffHunk[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

function stripPrefix(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '/dev/null') return trimmed
  return trimmed.replace(/^[ab]\//, '')
}

/**
 * Parse unified diff text into files. Tolerant of what runtimes actually
 * emit: Cursor's diffs carry absolute paths, Codex's carry `a/` `b/`
 * prefixes, and some carry no `diff --git` line at all.
 */
export function parseUnifiedDiff(text: string): readonly DiffFile[] {
  const files: DiffFile[] = []
  let oldPath: string | undefined
  let newPath: string | undefined
  let hunks: DiffHunk[] = []
  // `oldLeft` / `newLeft`: the lines the hunk's header says are still to come.
  let current: { header: DiffHunk; rows: DiffRow[]; oldNo: number; newNo: number; oldLeft: number; newLeft: number } | undefined

  const closeHunk = (): void => {
    if (current === undefined) return
    hunks.push({ ...current.header, rows: current.rows })
    current = undefined
  }
  const closeFile = (): void => {
    closeHunk()
    if (oldPath === undefined && newPath === undefined) {
      hunks = []
      return
    }
    /*
     * A file whose ONLY hunk starts from nothing ("@@ -0,0 ...") had no lines
     * before: it is new, whatever its header says (0.410). OpenCode's own
     * diff for a file it is about to create names the same path on both
     * sides, no /dev/null -- and an approval to create hello.txt read
     * "MODIFIED" while the same file read "ADDED" once written (fresh-eyes
     * check, Approvals). An existing EMPTY file given its first lines reads
     * the same, and "added" is true of every line in it.
     */
    const fromNothing = hunks.length === 1 && hunks[0]!.oldStart === 0 && hunks[0]!.oldCount === 0 && hunks[0]!.newCount > 0
    const status: DiffFileStatus =
      oldPath === '/dev/null' || fromNothing ? 'ADDED'
        : newPath === '/dev/null' ? 'DELETED'
          : oldPath !== undefined && newPath !== undefined && oldPath !== newPath ? 'RENAMED'
            : 'MODIFIED'
    const path = newPath === undefined || newPath === '/dev/null' ? (oldPath ?? '') : newPath
    files.push({ path, status, hunks })
    oldPath = undefined
    newPath = undefined
    hunks = []
  }

  for (const line of text.split('\n')) {
    /*
     * Inside a hunk that still expects lines, a line is a ROW, whatever it
     * begins with. M22 (the code review): `--- legacy column` -- a removed
     * SQL comment -- was read as the next file's header, which split the
     * file and made a phantom one, and an added `++ world` renamed it. The
     * header's counts say where the hunk ends, so they decide.
     */
    if (current !== undefined && (current.oldLeft > 0 || current.newLeft > 0)) {
      if (line.startsWith('+') && current.newLeft > 0) {
        current.rows.push({ kind: 'add', newNo: current.newNo, text: line.slice(1) })
        current.newNo += 1
        current.newLeft -= 1
        continue
      }
      if (line.startsWith('-') && current.oldLeft > 0) {
        current.rows.push({ kind: 'del', oldNo: current.oldNo, text: line.slice(1) })
        current.oldNo += 1
        current.oldLeft -= 1
        continue
      }
      if (line.startsWith(' ') && current.oldLeft > 0 && current.newLeft > 0) {
        current.rows.push({ kind: 'context', oldNo: current.oldNo, newNo: current.newNo, text: line.slice(1) })
        current.oldNo += 1
        current.newNo += 1
        current.oldLeft -= 1
        current.newLeft -= 1
        continue
      }
    }
    if (line.startsWith('--- ')) {
      // A new file starts at its `---` header, unless this is the first.
      if (oldPath !== undefined || hunks.length > 0) closeFile()
      oldPath = stripPrefix(line.slice(4))
      continue
    }
    if (line.startsWith('+++ ')) {
      newPath = stripPrefix(line.slice(4))
      continue
    }
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('\\ No newline')) {
      if (line.startsWith('diff --git') && (oldPath !== undefined || hunks.length > 0)) closeFile()
      continue
    }
    const match = HUNK.exec(line)
    if (match !== null) {
      closeHunk()
      const oldStart = Number(match[1])
      const newStart = Number(match[3])
      current = {
        header: {
          oldStart,
          oldCount: match[2] === undefined ? 1 : Number(match[2]),
          newStart,
          newCount: match[4] === undefined ? 1 : Number(match[4]),
          heading: (match[5] ?? '').trim(),
          rows: []
        },
        rows: [],
        oldNo: oldStart,
        newNo: newStart,
        oldLeft: match[2] === undefined ? 1 : Number(match[2]),
        newLeft: match[4] === undefined ? 1 : Number(match[4])
      }
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('+')) {
      current.rows.push({ kind: 'add', newNo: current.newNo, text: line.slice(1) })
      current.newNo += 1
    } else if (line.startsWith('-')) {
      current.rows.push({ kind: 'del', oldNo: current.oldNo, text: line.slice(1) })
      current.oldNo += 1
    } else if (line.startsWith(' ')) {
      // A blank context line arrives as a single space; a genuinely empty
      // line is the split's trailing artefact, or a runtime's blank line
      // between files, and is not a row.
      current.rows.push({ kind: 'context', oldNo: current.oldNo, newNo: current.newNo, text: line.slice(1) })
      current.oldNo += 1
      current.newNo += 1
    }
  }
  closeFile()
  return files
}

export interface DiffCounts {
  readonly added: number
  readonly removed: number
}

/** The counts a file's rows actually contain. The only source of `+N −M`. */
export function countRows(rows: readonly DiffRow[]): DiffCounts {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'add') added += 1
    else if (row.kind === 'del') removed += 1
  }
  return { added, removed }
}

/**
 * THE CODE AS IT READS AFTER THE CHANGE (0.649), for the opened change's Copy.
 * Colin, 2026-10-05: "if its a code change shouldnt it copy the code". Every
 * line but the removed ones, without signs or numbers, so it pastes as code;
 * separate parts of a file are separated by a blank line. A new file's change
 * is the whole file. Undefined for a deleted file: there is no code after it.
 */
export function afterText(file: DiffFile): string | undefined {
  if (file.status === 'DELETED') return undefined
  const parts = file.hunks.map((hunk) => hunk.rows.filter((row) => row.kind !== 'del').map((row) => row.text).join('\n')).filter((part) => part.length > 0)
  return parts.length === 0 ? undefined : parts.join('\n\n')
}

export function fileCounts(file: DiffFile): DiffCounts {
  return countRows(file.hunks.flatMap((hunk) => hunk.rows))
}

/**
 * A hunk's range line, DERIVED from its rows: `b = ctx + del`, `d = ctx +
 * add`. Never the header the runtime wrote, which may disagree.
 */
export function hunkRange(hunk: DiffHunk): string {
  const context = hunk.rows.filter((row) => row.kind === 'context').length
  const { added, removed } = countRows(hunk.rows)
  const oldCount = context + removed
  const newCount = context + added
  const span = (start: number, count: number): string => (count === 1 ? String(start) : `${String(start)},${String(count)}`)
  return `@@ -${span(hunk.oldStart, oldCount)} +${span(hunk.newStart, newCount)} @@`
}

/** How much context to keep visible around a change before folding. */
export const CONTEXT_LINES = 3

export type FoldedSegment =
  | { readonly kind: 'rows'; readonly rows: readonly DiffRow[] }
  | { readonly kind: 'fold'; readonly rows: readonly DiffRow[]; readonly count: number }

/**
 * Fold long runs of unchanged lines inside a hunk, keeping `context` lines
 * on either side of every change. The fold carries its exact count and the
 * rows it hides, so expanding it in place shows precisely what was folded.
 */
export function foldContext(rows: readonly DiffRow[], context = CONTEXT_LINES): readonly FoldedSegment[] {
  const keep = new Array<boolean>(rows.length).fill(false)
  rows.forEach((row, index) => {
    if (row.kind === 'context') return
    for (let near = Math.max(0, index - context); near <= Math.min(rows.length - 1, index + context); near += 1) {
      keep[near] = true
    }
  })
  const segments: FoldedSegment[] = []
  let run: DiffRow[] = []
  let runKept: boolean | undefined
  const flush = (): void => {
    if (run.length === 0) return
    if (runKept === true) segments.push({ kind: 'rows', rows: run })
    else segments.push({ kind: 'fold', rows: run, count: run.length })
    run = []
  }
  rows.forEach((row, index) => {
    const kept = keep[index] === true
    if (runKept !== undefined && kept !== runKept) flush()
    runKept = kept
    run.push(row)
  })
  flush()
  return segments
}

/** Hunks shown before the rest is deferred behind a button. */
export const HUNKS_SHOWN_FIRST = 2
/** A file changing more lines than this opens collapsed whatever its position. */
export const LARGE_FILE_LINES = 200

/**
 * The counts shown on a changed file's row.
 *
 * For a large change or cut diff, counts are either right or not shown:
 * - If the true counts can be known (from the tool's own record `reported`,
 *   or from the full untruncated text), show them.
 * - If they cannot, show no counts, and let LARGE say it -- never a count
 *   that is only part of the change.
 * - For a small diff, the parsed row counts are unchanged.
 */
export function fileRowCounts(file: {
  readonly counts: DiffCounts
  readonly truncated?: boolean
  readonly reported?: DiffCounts
  readonly large?: boolean
}): DiffCounts | undefined {
  if (file.reported !== undefined) return file.reported
  if (file.truncated) return undefined
  return file.counts
}

export interface Completeness {
  readonly shownHunks: number
  readonly totalHunks: number
  readonly remainingHunks: number
  readonly remainingLines: number
  /**
   * What the file's last line says. Never empty: one of `All N hunks shown`,
   * an expand invitation, or a stated remainder that could not be rendered.
   */
  readonly statement: string
  readonly canExpand: boolean
}

/**
 * The statement every open file ends with. This function cannot return an
 * empty string, which is the whole point of it.
 */
export function completenessOf(
  file: DiffFile,
  shownHunks: number,
  patchTruncated: boolean
): Completeness {
  const total = file.hunks.length
  const shown = Math.min(Math.max(shownHunks, 0), total)
  const remainingHunks = total - shown
  const remainingLines = file.hunks
    .slice(shown)
    .reduce((sum, hunk) => sum + hunk.rows.filter((row) => row.kind !== 'context').length, 0)
  const hunkWord = (count: number): string => `${String(count)} hunk${count === 1 ? '' : 's'}`
  if (patchTruncated) {
    return {
      shownHunks: shown,
      totalHunks: total,
      remainingHunks,
      remainingLines,
      statement: `The runtime reported more than fits here · ${hunkWord(shown)} rendered · the rest was not recorded inline`,
      canExpand: false
    }
  }
  if (remainingHunks === 0) {
    return {
      shownHunks: shown,
      totalHunks: total,
      remainingHunks: 0,
      remainingLines: 0,
      // In words a person uses: "hunk" is git's, and "All 1 hunk shown" read
      // as a sentence missing its point (first-impressions drive, 0.349).
      statement: total === 1 ? 'The whole change is shown' : `All ${String(total)} sections shown`,
      canExpand: false
    }
  }
  return {
    shownHunks: shown,
    totalHunks: total,
    remainingHunks,
    remainingLines,
    statement: `Expand full file · ${hunkWord(remainingHunks)} more, ${String(remainingLines)} line${remainingLines === 1 ? '' : 's'}`,
    canExpand: true
  }
}

export interface WordSpan {
  readonly text: string
  readonly changed: boolean
}

/**
 * Mark only what changed between a removed line and the added line that
 * replaced it: the common prefix and suffix stay plain. Without this the
 * reader diffs two whole lines by eye, which is where review mistakes come
 * from.
 */
export function wordDiff(oldText: string, newText: string): { readonly old: readonly WordSpan[]; readonly next: readonly WordSpan[] } {
  let prefix = 0
  const limit = Math.min(oldText.length, newText.length)
  while (prefix < limit && oldText[prefix] === newText[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < limit - prefix
    && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix += 1
  const spans = (text: string): readonly WordSpan[] => {
    const head = text.slice(0, prefix)
    const middle = text.slice(prefix, text.length - suffix)
    const tail = text.slice(text.length - suffix)
    const out: WordSpan[] = []
    if (head.length > 0) out.push({ text: head, changed: false })
    if (middle.length > 0) out.push({ text: middle, changed: true })
    if (tail.length > 0) out.push({ text: tail, changed: false })
    return out.length === 0 ? [{ text: '', changed: false }] : out
  }
  return { old: spans(oldText), next: spans(newText) }
}

/**
 * Pair each removed line with the added line that replaced it, so intra-line
 * spans can be drawn. A run of k deletions followed by k additions pairs
 * positionally; anything unpaired is a whole-line change.
 */
export function pairedSpans(rows: readonly DiffRow[]): ReadonlyMap<DiffRow, readonly WordSpan[]> {
  const spans = new Map<DiffRow, readonly WordSpan[]>()
  let index = 0
  while (index < rows.length) {
    if (rows[index]?.kind !== 'del') {
      index += 1
      continue
    }
    const dels: DiffRow[] = []
    while (rows[index]?.kind === 'del') dels.push(rows[index++]!)
    const adds: DiffRow[] = []
    while (rows[index]?.kind === 'add') adds.push(rows[index++]!)
    const pairs = Math.min(dels.length, adds.length)
    for (let pair = 0; pair < pairs; pair += 1) {
      const diff = wordDiff(dels[pair]!.text, adds[pair]!.text)
      spans.set(dels[pair]!, diff.old)
      spans.set(adds[pair]!, diff.next)
    }
  }
  return spans
}
