import { describe, expect, it } from 'vitest'

import { modeRefusedATool } from './missionView.js'

/**
 * Sol's beta review, 2026-09-21, finding 3.
 *
 * In Ask mode, asked to create a file: the file was correctly NOT created,
 * and the screen showed a red *"The run could not continue"* card with a
 * green **Run it again** button beside the sentence *"Nothing had started, so
 * running this again cannot repeat anything."* Pressing it would refuse
 * again, identically, for ever. Sol: *"No Run-it-again that admits it cannot
 * repeat. Offer Switch to Accept edits."*
 *
 * The switch-and-rerun press already existed — it was gated on the run having
 * produced a reply carrying code, which a run stopped at the first tool call
 * never does. So the one case that most needed it was the only case excluded.
 *
 * The renderer is handed a SENTENCE, not a reason code, so the predicate has
 * to match text the adapter writes. The control for that drift lives on the
 * adapter's side, where the words are: `a-refusal-is-not-a-crash.test.ts` now
 * pins the whole phrase against the message its normalizer builds. Reword it
 * there and that test fails, rather than this offer quietly disappearing.
 */
describe('a refusal offers the mode that works', () => {
  it('reads a mode refusal as a refusal', () => {
    expect(
      modeRefusedATool(
        'The mode this run is in does not allow bash, so OpenCode stopped when it tried to use it. Nothing was changed.'
      )
    ).toBe(true)
    for (const tool of ['edit', 'write', 'patch']) {
      expect(modeRefusedATool(`The mode this run is in does not allow ${tool}, so OpenCode stopped.`)).toBe(true)
    }
  })

  it('reads everything else as something that actually went wrong', () => {
    expect(modeRefusedATool(undefined)).toBe(false)
    expect(modeRefusedATool('OpenCode exited with code 1.')).toBe(false)
    expect(modeRefusedATool('OpenCode ended without a step that reported it had stopped.')).toBe(false)
    // The confined-workspace refusal is a DIFFERENT case with its own
    // sentence: the answer there is not "switch to Accept edits", because the
    // folder boundary holds in every mode.
    expect(
      modeRefusedATool('OpenCode asked for C:/other, which is outside the folder this run may use, and stopped.')
    ).toBe(false)
  })

})
