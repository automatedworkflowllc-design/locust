/**
 * A PDF PAGE'S TEXT, IN THE ORDER IT IS READ (0.713).
 *
 * pdf.js hands back a page's text as runs of characters, each with where it
 * was drawn, in whatever order the file drew them. Joined as given, a page
 * set in TeX reads as one paragraph with the subscripts glued to the next
 * word and a matrix's rows run together -- the shape of the text a tester's
 * homework turned into when Codex had to decode the PDF by hand (0.712).
 *
 * So the runs are put back on their lines: grouped by height on the page,
 * read left to right, a space where the gap is a word's and two where it is
 * a column's -- which is what keeps a matrix's entries apart. A sub- or
 * superscript sits a little above or below its line and joins it. Nothing is
 * dropped; what cannot be told apart stays in the order it came.
 *
 * Pure, so it is tested without a PDF (a-pdf-arrives-readable.test.ts).
 */

export interface TextRun {
  readonly str: string
  /** pdf.js's transform: [a, b, c, d, x, y], y up from the page's bottom. */
  readonly transform: readonly number[]
  readonly width: number
  readonly height: number
}

interface Placed {
  readonly str: string
  readonly x: number
  readonly y: number
  readonly end: number
  readonly size: number
}

function placed(run: TextRun): Placed | undefined {
  if (run.str.length === 0) return undefined
  const [, , c = 0, d = 0, x = 0, y = 0] = run.transform
  // The run's font size is the length of its vertical axis; a run without
  // one (a bare transform) borrows its height, then a reading size.
  const size = Math.hypot(c, d) || run.height || 10
  if (![x, y, size].every(Number.isFinite)) return undefined
  return { str: run.str, x, y, end: x + (Number.isFinite(run.width) ? run.width : 0), size }
}

/** One page's runs, as lines of text, top to bottom. */
export function pageText(runs: readonly TextRun[]): string {
  const items = runs.flatMap((run) => {
    const one = placed(run)
    return one === undefined ? [] : [one]
  })
  if (items.length === 0) return ''
  // Top first; on one height, left first.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; size: number; items: Placed[] }[] = []
  for (const item of sorted) {
    const line = lines[lines.length - 1]
    // Within six tenths of the larger size: a script beside its line joins
    // it, the next line of a paragraph (a whole line-height away) does not.
    if (line !== undefined && Math.abs(line.y - item.y) <= 0.6 * Math.max(line.size, item.size)) {
      line.items.push(item)
      // The line's height is its biggest run's: a superscript does not move it.
      if (item.size > line.size) {
        line.size = item.size
        line.y = item.y
      }
      continue
    }
    lines.push({ y: item.y, size: item.size, items: [item] })
  }
  return lines
    .map((line) => {
      const ordered = [...line.items].sort((a, b) => a.x - b.x)
      let text = ''
      let reached: number | undefined
      for (const item of ordered) {
        if (reached !== undefined) {
          const gap = item.x - reached
          const spaced = /\s$/.test(text) || /^\s/.test(item.str)
          if (!spaced && gap > line.size) text += '  '
          else if (!spaced && gap > 0.2 * Math.min(line.size, item.size)) text += ' '
        }
        text += item.str
        reached = Math.max(reached ?? item.end, item.end)
      }
      return text.replace(/\s+$/, '')
    })
    .filter((text) => text.length > 0)
    .join('\n')
}
