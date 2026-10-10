import type { ColouredToken } from './codeColors.js'
import type { DiffHunk, DiffRow, WordSpan } from './diff.js'

/**
 * A CHANGE'S CODE, IN COLOUR (0.725). Code in a reply and an opened file have been coloured since 0.719; a diff
 * was still one grey (the plan's look-and-feel table: "Diffs and the file viewer are still plain").
 *
 * Each hunk is coloured as two pieces of code, the lines as they read before (context and removed) and after
 * (context and added), so a comment or a string that runs over several lines is coloured as the grammar sees it
 * rather than line by line. Each row then takes its line from its side.
 */
export interface HunkSides {
  readonly before: string
  readonly after: string
  /** Which side's line each row is. */
  readonly at: ReadonlyMap<DiffRow, { readonly side: 'before' | 'after'; readonly line: number }>
}

export function hunkSides(hunk: DiffHunk): HunkSides {
  const before: string[] = []
  const after: string[] = []
  const at = new Map<DiffRow, { readonly side: 'before' | 'after'; readonly line: number }>()
  for (const row of hunk.rows) {
    if (row.kind === 'del') {
      at.set(row, { side: 'before', line: before.length })
      before.push(row.text)
    } else if (row.kind === 'add') {
      at.set(row, { side: 'after', line: after.length })
      after.push(row.text)
    } else {
      at.set(row, { side: 'after', line: after.length })
      before.push(row.text)
      after.push(row.text)
    }
  }
  return { before: before.join('\n'), after: after.join('\n'), at }
}

/** One run of a row's text: its colour, if any, and whether it is a word the change touched. */
export interface PaintedRun {
  readonly text: string
  readonly color?: string
  readonly changed: boolean
}

/**
 * A row's text as runs, its colours and its changed words laid over each other. Colours that do not spell the
 * row's own text exactly are not used: the row is drawn plain, which is never wrong.
 */
export function paintRow(text: string, tokens: readonly ColouredToken[] | undefined, spans: readonly WordSpan[] | undefined): readonly PaintedRun[] {
  const usable = tokens !== undefined && tokens.map((token) => token.content).join('') === text ? tokens : undefined
  const marks = spans !== undefined && spans.map((span) => span.text).join('') === text ? spans : undefined
  if (usable === undefined) return marks === undefined ? [{ text, changed: false }] : marks.map((span) => ({ text: span.text, changed: span.changed }))
  if (marks === undefined) return usable.map((token) => (token.color === undefined ? { text: token.content, changed: false } : { text: token.content, color: token.color, changed: false }))
  // Both: cut at every boundary either one has.
  const runs: PaintedRun[] = []
  let tokenAt = 0
  let tokenUsed = 0
  let spanAt = 0
  let spanUsed = 0
  while (tokenAt < usable.length && spanAt < marks.length) {
    const token = usable[tokenAt]!
    const span = marks[spanAt]!
    const take = Math.min(token.content.length - tokenUsed, span.text.length - spanUsed)
    if (take > 0) {
      const piece = token.content.slice(tokenUsed, tokenUsed + take)
      const last = runs[runs.length - 1]
      if (last !== undefined && last.color === token.color && last.changed === span.changed) runs[runs.length - 1] = { ...last, text: last.text + piece }
      else runs.push(token.color === undefined ? { text: piece, changed: span.changed } : { text: piece, color: token.color, changed: span.changed })
    }
    tokenUsed += take
    spanUsed += take
    if (tokenUsed >= token.content.length) {
      tokenAt += 1
      tokenUsed = 0
    }
    if (spanUsed >= span.text.length) {
      spanAt += 1
      spanUsed = 0
    }
  }
  return runs
}
