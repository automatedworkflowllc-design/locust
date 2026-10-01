import type { DiffFile, DiffRow } from './diff.js'
import { wordDiff } from './diff.js'

/**
 * A DOCUMENT'S CHANGE, IN ITS OWN WORDS (0.530).
 *
 * Sol's 0.528 pass, as an office user: "What turn 2 changed" on a Markdown
 * policy showed `@@ -1,11 +1,11 @@`, line numbers, `#` and table pipes -- the
 * change was right, and reading it took a developer. For a document the
 * change is now a list of passages: a changed one with its old words struck
 * and its new words marked, an added one, a removed one -- each as the words a
 * reader sees, Markdown's marks taken off. The line view is a click away.
 */
export type ChangedPassage =
  | { readonly kind: 'changed'; readonly before: string; readonly removed: string; readonly added: string; readonly after: string }
  | { readonly kind: 'added'; readonly text: string }
  | { readonly kind: 'removed'; readonly text: string }

/** A Markdown line as a reader sees it: no heading hashes, bullets as bullets, a table row as its cells. */
export function asRead(line: string): string {
  const trimmed = line.trim()
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(trimmed)) return ''
  if (trimmed.startsWith('|')) {
    return trimmed.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|')).join(' · ')
  }
  return trimmed
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/^>\s?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
}

/** A letter or digit in any script: what a word is made of. */
const WORD = /[\p{L}\p{N}]/u

export function documentChanges(file: DiffFile): readonly ChangedPassage[] {
  const passages: ChangedPassage[] = []
  const push = (passage: ChangedPassage): void => {
    // A line that reads as nothing (a table's --- row, a blank) is not a passage.
    if (passage.kind === 'changed' ? passage.before + passage.removed + passage.added + passage.after === '' : passage.text === '') return
    passages.push(passage)
  }
  for (const hunk of file.hunks) {
    const rows: readonly DiffRow[] = hunk.rows
    let index = 0
    while (index < rows.length) {
      if (rows[index]?.kind === 'context') {
        index += 1
        continue
      }
      const dels: string[] = []
      while (rows[index]?.kind === 'del') dels.push(asRead(rows[index++]!.text))
      const adds: string[] = []
      while (rows[index]?.kind === 'add') adds.push(asRead(rows[index++]!.text))
      const pairs = Math.min(dels.length, adds.length)
      for (let pair = 0; pair < pairs; pair += 1) {
        const old = dels[pair]!
        const next = adds[pair]!
        if (old === next) continue
        const diff = wordDiff(old, next)
        let head = diff.next[0]?.changed === false ? diff.next[0].text.length : 0
        let tail = diff.next.length > 1 && diff.next[diff.next.length - 1]?.changed === false ? diff.next[diff.next.length - 1]!.text.length : 0
        // WHOLE WORDS (seen on drive-an-earlier-version-reads): the characters
        // "day" are common to Monday and Tuesday, and the change read
        // "~~Mon~~Tuesday". A cut inside a word moves out to the word's edge.
        while (head > 0 && WORD.test(old[head - 1] ?? '') && (WORD.test(old[head] ?? '') || WORD.test(next[head] ?? ''))) head -= 1
        while (tail > 0 && WORD.test(old[old.length - tail] ?? '') && (WORD.test(old[old.length - tail - 1] ?? '') || WORD.test(next[next.length - tail - 1] ?? ''))) tail -= 1
        push({ kind: 'changed', before: old.slice(0, head), removed: old.slice(head, old.length - tail), added: next.slice(head, next.length - tail), after: tail === 0 ? '' : old.slice(old.length - tail) })
      }
      for (const text of dels.slice(pairs)) push({ kind: 'removed', text })
      for (const text of adds.slice(pairs)) push({ kind: 'added', text })
    }
  }
  return passages
}
