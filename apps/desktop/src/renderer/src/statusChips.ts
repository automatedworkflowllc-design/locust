/**
 * A TABLE'S STATUS, AS CHIPS (0.728).
 *
 * The plan's look-and-feel table: Claude's docs keep a table whose Status column changes as the work goes; a
 * Locust teammate writes the same table in a reply and it was words in cells. A column headed Status (or State,
 * Stage, Progress) now draws each value it knows as a chip in its tone -- done green, under way blue, waiting
 * amber, stuck red, not begun quiet -- so a teammate's tracker reads at a glance, and the next reply's rewritten
 * table reads as the same tracker moved on. A value it does not know stays the text it was.
 */
export type StatusTone = 'green' | 'blue' | 'amber' | 'red' | 'quiet'

const HEADERS = /^(?:status|state|stage|progress)$/i

/** What a chip can be changed to (0.733), one word per tone, in the order work goes. */
export const STATUS_CHOICES: readonly { readonly label: string; readonly tone: StatusTone }[] = [
  { label: 'Not started', tone: 'quiet' },
  { label: 'In progress', tone: 'blue' },
  { label: 'Waiting', tone: 'amber' },
  { label: 'Blocked', tone: 'red' },
  { label: 'Done', tone: 'green' }
]

/** The column a table's status is in, by its header; undefined when it has none. */
export function statusColumnOf(header: readonly string[]): number | undefined {
  const at = header.findIndex((cell) => HEADERS.test(plainOf(cell)))
  return at < 0 ? undefined : at
}

const TONES: readonly { readonly tone: StatusTone; readonly words: readonly string[] }[] = [
  { tone: 'red', words: ['blocked', 'failed', 'failing', 'fail', 'error', 'broken', 'cancelled', 'canceled', 'at risk', 'overdue', 'stuck'] },
  { tone: 'green', words: ['done', 'complete', 'completed', 'finished', 'shipped', 'merged', 'fixed', 'resolved', 'passed', 'passing', 'pass', 'approved', 'live', 'ready'] },
  { tone: 'blue', words: ['in progress', 'in-progress', 'doing', 'working', 'running', 'started', 'ongoing', 'underway', 'under way', 'wip', 'active'] },
  { tone: 'amber', words: ['in review', 'review', 'needs review', 'waiting', 'pending', 'on hold', 'paused', 'partial', 'partly done'] },
  { tone: 'quiet', words: ['to do', 'todo', 'not started', 'planned', 'queued', 'backlog', 'next', 'open', 'not begun'] }
]

/** A cell's words without the marks around them: `**Done**`, `` `wip` ``, a leading ✅. */
function plainOf(cell: string): string {
  return cell
    .replace(/[*_`~]/g, '')
    .replace(/^[\s\p{Extended_Pictographic}️‍]+/u, '')
    .trim()
    .toLowerCase()
}

/** The tone a status cell says, from its first words; undefined for anything it does not know. */
export function statusToneOf(cell: string): StatusTone | undefined {
  const words = plainOf(cell)
  if (words.length === 0 || words.length > 40) return undefined
  for (const { tone, words: known } of TONES) {
    for (const word of known) {
      if (words === word || (words.startsWith(word) && /^[\s:;,.()\-–—/]/.test(words.slice(word.length)))) return tone
    }
  }
  return undefined
}
