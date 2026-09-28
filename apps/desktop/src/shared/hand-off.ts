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
  'End your reply with exactly one line: "VERDICT: APPROVED", or "VERDICT: CHANGES NEEDED -- " followed by what must change.'

/** Room for the quoted answer: the prompt must fit the mission's own limit with the step's words and the rule. */
const OVERHEAD = 200

export function handOffPrompt(input: {
  /** The step's own words, as the person wrote them. */
  readonly step: string
  /** Who did the step before, and what they answered; absent when this step follows its own teammate. */
  readonly from?: { readonly name: string; readonly answer: string | undefined }
  readonly check?: boolean
}): string {
  const rule = input.check === true ? CHECK_RULE : ''
  const parts: string[] = []
  if (input.from !== undefined) {
    const room = Math.max(0, STEP_BUDGET - input.step.length - rule.length - OVERHEAD)
    const answer = (input.from.answer ?? '').trim()
    const quoted = answer.length === 0
      ? `(${input.from.name}'s answer could not be read; their conversation has it.)`
      : answer.length <= room
        ? answer
        : `${answer.slice(0, Math.max(0, room - 80)).trimEnd()}\n... (cut short here; ${input.from.name}'s conversation has the rest)`
    parts.push(`${input.from.name} did the step before this one and answered:\n\n${quoted}`)
  }
  if (rule.length > 0) parts.push(rule)
  parts.push(input.step)
  return parts.join('\n\n')
}

export type Verdict = { readonly approved: true } | { readonly approved: false; readonly changes: string }

/**
 * The checker's verdict: the LAST line that says one, so a verdict quoted
 * earlier in the reply is not taken for this one. Undefined when there is
 * none -- which the runner treats as not approved.
 */
export function verdictOf(reply: string | undefined): Verdict | undefined {
  if (reply === undefined) return undefined
  const lines = reply.split(/\r?\n/).map((line) => line.replace(/^[\s>*_`#-]+|[\s*_`]+$/g, '').trim())
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const match = /^VERDICT:\s*(APPROVED|CHANGES NEEDED)\b\s*(?:[-—–:]+\s*)?(.*)$/i.exec(lines[at] ?? '')
    if (match === null) continue
    if (match[1]!.toUpperCase() === 'APPROVED') return { approved: true }
    return { approved: false, changes: (match[2] ?? '').trim() }
  }
  return undefined
}
