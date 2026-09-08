/**
 * How long a routine step can be before it stops being sendable.
 *
 * Two caps disagreed, and only one of them was enforced where a person could
 * see it. `MAX_STEP_LENGTH` (routine-store) is 20,000, so the edit dialog
 * happily saved a step half again larger than `MAX_RUNTIME_PROMPT_LENGTH`
 * (workroom-briefing), which is 12,000 for the whole prompt -- the step, the
 * workspace briefing, any waiting peer messages and the roster trailer
 * together. Its own comment names the intended room for the person's words:
 * "Room for the person's 8,000, the quoted messages, and the roster trailer."
 *
 * The consequence was worse than "it will not send", and is written up as R4
 * in `docs/ROUTINES-RECHECK-2026-09-08.md`: an over-long step made
 * `composeRuntimePrompt` shed every waiting peer message trying to fit, fail
 * anyway, and send the over-long prompt regardless. The messages were
 * sacrificed for nothing. That half is fixed; this is the other half -- saying
 * so at the moment it is typed, rather than letting it be saved and fail
 * later.
 *
 * The cap itself is deliberately NOT lowered. `parsedRoutine` validates step
 * length on READ, so dropping `MAX_STEP_LENGTH` to 8,000 would make routines
 * people already saved unreadable. A warning costs nobody their work.
 */

/**
 * The room a step has, in characters.
 *
 * Named from `MAX_RUNTIME_PROMPT_LENGTH`'s own accounting rather than picked:
 * 12,000 for everything, of which 8,000 was always meant to be the person's.
 */
export const STEP_BUDGET = 8_000

/**
 * What to tell someone about a step this long, or undefined when it is fine.
 *
 * Returns a sentence rather than a boolean because the number is the useful
 * part -- "too long" invites deleting until it stops complaining, and a person
 * who can see they are 1,400 over knows what to cut.
 */
export function stepTooLongNotice(step: string): string | undefined {
  if (step.length <= STEP_BUDGET) return undefined
  const over = step.length - STEP_BUDGET
  return `${String(over)} character${over === 1 ? '' : 's'} too long. A step shares its message with the workspace briefing and anything waiting from teammates, so about ${String(STEP_BUDGET)} is the room it has.`
}
