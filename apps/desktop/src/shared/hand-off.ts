import { STEP_BUDGET } from './step-budget.js'

/**
 * A HAND-OFF CHAIN'S WORDS (0.435).
 *
 * A routine step that goes to another teammate is given the answer of the
 * step before it, quoted, above the person's own words for the step -- the
 * person's words last, as in every brief. A CHECKER step is also told how to
 * say whether the work passes, in one line the runner can read. From
 * OpenRig's conveyor (mvschwarz/openrig, Apache-2.0), reimplemented from its
 * idea.
 */

/** What a checker must end with: approval, or what has to change. */
export const CHECK_RULE =
  'You are the checker for this routine: the run counts as done only if you approve. Check the work above against what was asked. ' +
  // Measured, 0.437 promo frames: a Codex checker quoted an OpenCode teammate
  // whose read-only mode has no shell, and concluded IT could not read the
  // files either -- it never tried, and refused a right answer.
  'Read the files it concerns yourself: you can read this folder, whatever the teammate before you could or could not do in their mode, and their answer is a claim to check, not a fact. ' +
  'End your reply with exactly one line: "VERDICT: APPROVED", or "VERDICT: CHANGES NEEDED -- " followed by what must change.'

/** Room for the quoted answer: the prompt must fit the mission's own limit with the step's words and the rule. */
const OVERHEAD = 200

/**
 * Where the step's own words begin. The record keeps the whole prompt -- it
 * is what the runtime was given -- and a person reading the conversation is
 * shown the words after this, the way a relay's briefing is never a title.
 */
export const STEP_MARK = 'Your step: '

export function handOffPrompt(input: {
  /** The step's own words, as the person wrote them. */
  readonly step: string
  /** Who did the step before, and what they answered; absent when this step follows its own teammate. */
  readonly from?: { readonly name: string; readonly answer: string | undefined }
  readonly check?: boolean
  /**
   * What the chain was for: the routine's first step, for a checker. The
   * packaged drive's first checker refused to approve a correct plan because
   * "no issue description is included" -- it was shown the plan and not the
   * problem the plan was for.
   */
  readonly task?: string
}): string {
  const rule = input.check === true ? CHECK_RULE : ''
  const task = input.check === true && input.task !== undefined && input.task.trim().length > 0
    ? `The routine's task, as its first step asked: ${input.task.trim().slice(0, 1500)}`
    : ''
  const parts: string[] = []
  if (task.length > 0) parts.push(task)
  if (input.from !== undefined) {
    const room = Math.max(0, STEP_BUDGET - input.step.length - rule.length - task.length - OVERHEAD)
    const answer = (input.from.answer ?? '').trim()
    const quoted = answer.length === 0
      ? `(${input.from.name}'s answer could not be read; their conversation has it.)`
      : answer.length <= room
        ? answer
        : `${answer.slice(0, Math.max(0, room - 80)).trimEnd()}\n... (cut short here; ${input.from.name}'s conversation has the rest)`
    parts.push(`${input.from.name} did the step before this one and answered:\n\n${quoted}`)
  }
  if (rule.length > 0) parts.push(rule)
  parts.push(`${STEP_MARK}${input.step}`)
  return parts.join('\n\n')
}

/**
 * The step's own words out of a hand-off prompt: the text after the LAST mark,
 * so a quoted answer that happens to contain one cannot move it. A prompt with
 * no mark is returned as it is -- a step that was not handed anything.
 */
export function stepWordsOf(prompt: string): string {
  const at = prompt.lastIndexOf(`\n\n${STEP_MARK}`)
  return at < 0 ? prompt : prompt.slice(at + 2 + STEP_MARK.length)
}

export type Verdict = { readonly approved: true } | { readonly approved: false; readonly changes: string }

/**
 * The checker's verdict: the LAST line that says one, so a verdict quoted
 * earlier in the reply is not taken for this one. Undefined when there is
 * none -- which the runner treats as not approved.
 *
 * ONLY A PLAIN APPROVAL APPROVES (QA-2026-09-29 round 2, R11). The gate
 * promises the run counts as done only if the checker approves, and a line
 * that merely STARTED "VERDICT: APPROVED" passed it: "APPROVED WITH CHANGES",
 * "APPROVED, but the tests fail", "APPROVED -- although the build is red", and
 * a verdict shown as an example inside a code fence. Now the last verdict line
 * decides; it approves only when nothing but closing punctuation follows
 * APPROVED, and anything else is changes needed, in the checker's own words.
 * Lines inside a code fence are examples, never the verdict.
 */
export function verdictOf(reply: string | undefined): Verdict | undefined {
  if (reply === undefined) return undefined
  const raw = reply.split(/\r?\n/)
  let fenced = false
  const lines: string[] = []
  for (const line of raw) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    lines.push(fenced ? '' : line.replace(/^[\s>*_`#-]+|[\s*_`]+$/g, '').trim())
  }
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const match = /^VERDICT:\s*(.*)$/i.exec(lines[at] ?? '')
    if (match === null) continue
    const said = (match[1] ?? '').trim()
    if (/^APPROVED[.!]?$/i.test(said)) return { approved: true }
    const needed = /^CHANGES NEEDED\b\s*(?:[-—–:]+\s*)?(.*)$/i.exec(said)
    if (needed !== null) return { approved: false, changes: (needed[1] ?? '').trim() }
    // Hedged, qualified or anything else: not an approval, and said as it was.
    return { approved: false, changes: said }
  }
  return undefined
}
