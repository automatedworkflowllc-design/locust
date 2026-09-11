/**
 * Handing a finished mission to another teammate to be challenged.
 *
 * Astra's proposal, 2026-09-11, part 2: "One reviewer teammate, on Cursor,
 * reading the evidence block. Its job is the one Astra names: challenge the
 * change against the original request." The sequencing was deliberate --
 * "only after 1a lands", because until a turn said what it RAN a reviewer had
 * nothing to read but the diff, and a second model re-reading a diff is a
 * second opinion about code rather than a check on whether the work was done.
 *
 * What a reviewer is given is exactly what the record holds and nothing else:
 *
 *   - the request the person actually made, as they typed it
 *   - what changed, by path
 *   - what ran, and what came back
 *   - the conditions it ran under
 *
 * Every one of those is already on screen. The point of the brief is not to
 * compute anything new; it is that a reviewer cannot see another teammate's
 * conversation, so the facts have to travel.
 *
 * THE BRIEF MAKES NO CLAIM ABOUT QUALITY. It does not say the work looks
 * done, or that the commands amount to proof -- the same discipline the trace
 * line keeps (`commandsRunText`, and the ruling in
 * `docs/RULING-2026-09-11-SCOPE-NOT-ABSENCE.md`). Telling a reviewer the work
 * passed and then asking it to check would be handing it the answer.
 */

export interface ReviewMaterial {
  /** What the person asked for, in their words. */
  readonly request: string
  /** Paths this run changed, as the receipt counts them. */
  readonly changed: readonly string[]
  /** Commands it ran, first word and exit code, in order. */
  readonly commands: readonly { readonly name: string; readonly exitCode: number | undefined }[]
  /** The conditions, from `ranOnLine`. */
  readonly ranOn: string
  /** Who did the work, so the reviewer knows whose turn it is challenging. */
  readonly author: string
}

/** Long enough to carry a real request, short enough not to be the whole turn. */
const MAX_REQUEST = 1_200
const MAX_PATHS = 20
const MAX_COMMANDS = 12

function bounded(text: string, limit: number): string {
  const clean = text.replace(/\r\n?/g, '\n').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

/**
 * The brief, as the reviewer's mission prompt.
 *
 * Written as a job rather than as a question. A reviewer asked "what do you
 * think?" produces an opinion; a reviewer told what was asked for, what
 * changed and what ran can say whether those three agree, which is the only
 * thing it is in a position to know.
 */
export function reviewBrief(material: ReviewMaterial): string {
  const lines: string[] = []
  lines.push(
    `${material.author} finished a piece of work and you are reviewing it. You did not do this work and you cannot see their conversation; everything known about it is below.`
  )
  lines.push('')
  lines.push('WHAT WAS ASKED FOR')
  lines.push(bounded(material.request, MAX_REQUEST))
  lines.push('')

  lines.push('WHAT CHANGED')
  if (material.changed.length === 0) {
    lines.push('Nothing in the workspace.')
  } else {
    for (const path of material.changed.slice(0, MAX_PATHS)) lines.push(`- ${path}`)
    const rest = material.changed.length - MAX_PATHS
    if (rest > 0) lines.push(`- and ${String(rest)} more`)
  }
  lines.push('')

  lines.push('WHAT RAN')
  if (material.commands.length === 0) {
    lines.push('No commands were run.')
  } else {
    for (const command of material.commands.slice(0, MAX_COMMANDS)) {
      lines.push(`- ${command.name}${command.exitCode === undefined ? ' (no exit code recorded)' : ` — exit ${String(command.exitCode)}`}`)
    }
    const rest = material.commands.length - MAX_COMMANDS
    if (rest > 0) lines.push(`- and ${String(rest)} more`)
  }
  lines.push('')

  lines.push('WHERE IT RAN')
  lines.push(material.ranOn)
  lines.push('')

  lines.push('YOUR JOB')
  lines.push(
    'Say whether the change does what was asked for, and name anything it misses or breaks. Read the files it changed; you may run commands to check.'
  )
  // The two failure modes of a reviewer, said as rules. Both were watched for
  // in the proposal: a reviewer that redoes the work is a second builder, and
  // a reviewer that approves everything is worse than none.
  lines.push('Do not redo the work or make the change yourself. Report; do not fix.')
  lines.push(
    'If it does what was asked, say so plainly and stop — a short answer is the right answer for work that is fine. If something is wrong, name the file and what is wrong with it.'
  )
  // The exact claim this whole feature exists to stop being made by accident.
  lines.push(
    'The commands above are what was run, not proof that the work is correct: a command exiting 0 says only that it exited 0. Decide for yourself what it does and does not show.'
  )
  return lines.join('\n')
}
