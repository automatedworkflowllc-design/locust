import { defangProtocolBlocks } from '../../shared/protocolTags.js'

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
 *   - what the teammate said back
 *   - what changed, by path
 *   - what ran, and what came back
 *   - the conditions it ran under
 *
 * The reply was missing until 2026-09-13, and its absence made this feature
 * lie. Colin asked for a review of a stock research turn and was told "That
 * did not happen... The work is missing entirely" -- because research changes
 * no paths and runs no commands, so the brief said only "Nothing in the
 * workspace" and "No commands were run", and the reviewer believed it. That
 * is this app's own ruling broken by this app: state scope, not absence
 * (`docs/RULING-2026-09-11-SCOPE-NOT-ABSENCE.md`). A turn whose deliverable
 * is an ANSWER is in scope; the brief presented it as an emptiness and
 * invited the reviewer to name what was missing.
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
  /**
   * What the teammate said back -- the assistant text of the turn, joined.
   *
   * For research, a question, a recommendation -- most of what is actually
   * asked for -- this is the whole deliverable and the only evidence there
   * is. Empty only when a turn genuinely said nothing.
   */
  readonly said: string
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
/**
 * The reply gets the largest budget of anything here, because for most turns
 * it IS the work. It is still bounded: a brief that carries a whole long
 * session would cost more to read than the review is worth, and the truncation
 * is said out loud rather than left as a silent cut.
 */
const MAX_SAID = 8_000
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

  // Above what changed, deliberately: for a question, a recommendation or a
  // piece of research this is the entire deliverable, and a reviewer that
  // reads the paths first reads an emptiness first.
  lines.push('WHAT THEY SAID')
  if (material.said.trim().length === 0) {
    lines.push('This turn recorded no reply text.')
  } else {
    /*
     * Defanged, because this is one model's words becoming another model's
     * instructions.
     *
     * Carrying the reply (0.96.0) opened a path peer messages have been
     * defended against since they existed: a reviewed turn very often
     * contains a `<locust-memory>` block, because that is how a teammate
     * remembers something. Quoted raw into the reviewer's prompt, a reviewer
     * that echoes it -- and models echo what they are asked to assess -- has
     * that block parsed out of ITS reply and written to the team's memory,
     * under its name, with nobody having asked.
     */
    const said = bounded(defangProtocolBlocks(material.said), MAX_SAID)
    lines.push(said)
    if (said !== material.said.replace(/\r\n?/g, '\n').trim()) {
      lines.push('(The reply was longer than this; the rest is in their thread.)')
    }
  }
  lines.push('')

  // The two negatives, when they are BOTH negatives, are said once as a fact
  // about the kind of work rather than twice as an absence.
  if (material.changed.length === 0 && material.commands.length === 0) {
    lines.push('WHAT IT DID IN THE WORKSPACE')
    lines.push('This turn answered in the conversation; it changed no files and ran no commands.')
    lines.push('')
    lines.push('WHERE IT RAN')
    lines.push(material.ranOn)
    lines.push('')
    lines.push(...jobLines())
    return lines.join('\n')
  }

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

  lines.push(...jobLines())
  return lines.join('\n')
}

/**
 * The job, said the same way whatever kind of work it was.
 *
 * "The change" was the old wording throughout, and it is what told a reviewer
 * of a research turn that the thing it was looking for was a diff.
 */
function jobLines(): readonly string[] {
  return [
    'YOUR JOB',
    'Say whether the work does what was asked for, and name anything it misses or gets wrong. Read what they said, and the files they changed if there are any; you may run commands to check.',
    // Not every turn leaves a trace in the workspace, and the reviewer must
    // not read that as the work being absent -- it said so once already.
    'A turn that only answered is a complete piece of work. Judge the answer.',
    // The two failure modes of a reviewer, said as rules. Both were watched for
    // in the proposal: a reviewer that redoes the work is a second builder, and
    // a reviewer that approves everything is worse than none.
    'Do not redo the work or make the change yourself. Report; do not fix.',
    'If it does what was asked, say so plainly and stop — a short answer is the right answer for work that is fine. If something is wrong, name the file and what is wrong with it.',
    // The exact claim this whole feature exists to stop being made by accident.
    'The commands above are what was run, not proof that the work is correct: a command exiting 0 says only that it exited 0. Decide for yourself what it does and does not show.'
  ]
}
