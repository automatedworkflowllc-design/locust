/**
 * `@` FOR A FILE OF THE PROJECT (0.436).
 *
 * Typing `@` in the composer offers the folder's files, narrowed as you type,
 * the way Claude Code's composer does; picking one attaches it exactly as the
 * `+` menu's file picker does. What is being typed is the `@word` at the END
 * of the message -- an `@` inside a sentence ("email me @ noon") is not one.
 */

/** The file being asked for, if the message ends in `@something` (or a bare `@`). */
export function atQuery(text: string): string | undefined {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text)
  return match === null ? undefined : match[1] ?? ''
}

/** The message with the trailing `@something` taken out, once its file is picked. */
export function withoutAtQuery(text: string): string {
  return text.replace(/(^|\s)@[^\s@]*$/, '$1')
}

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Whether every character of `query` appears in `text`, in order. */
function inOrder(text: string, query: string): boolean {
  let at = 0
  for (const character of text) {
    if (character === query[at]) at += 1
    if (at === query.length) return true
  }
  return query.length === 0
}

/**
 * The files that match, best first: a name that IS what was typed, then one
 * that starts with it, then one that has it, then a path that has it, then a
 * path that has its letters in order. Shorter paths first within each.
 */
export function fileMatches(paths: readonly string[], query: string, max = 8): readonly string[] {
  const q = query.toLowerCase().replace(/\\/g, '/')
  const ranked: { readonly path: string; readonly rank: number }[] = []
  for (const path of paths) {
    const lower = path.toLowerCase()
    const base = baseOf(lower)
    const rank = q.length === 0 ? 0
      : base === q ? 0
        : base.startsWith(q) ? 1
          : base.includes(q) ? 2
            : lower.includes(q) ? 3
              : inOrder(lower, q) ? 4
                : -1
    if (rank >= 0) ranked.push({ path, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank || a.path.split('/').length - b.path.split('/').length || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return ranked.slice(0, max).map((entry) => entry.path)
}
