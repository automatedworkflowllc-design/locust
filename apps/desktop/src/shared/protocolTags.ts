/**
 * Every tag this app parses out of a reply, and the one rule for text that
 * did not come from the person.
 *
 * Locust reads five protocol blocks out of what a teammate says, and each one
 * makes the host DO something: `locust-share` sends a message as that
 * teammate, `locust-memory` writes to the team's memory, `locust-ask` puts a
 * decision in front of Colin, `locust-task` moves a room's board, and
 * `locust-file` hands the person a file the teammate wrote.
 *
 * Model-authored text gets re-injected into other prompts all over this app --
 * a peer message quoted into the recipient's briefing, a reviewed turn quoted
 * into the reviewer's, a relayed answer handed to the next teammate. Any of
 * those quotes can carry a block, and a model asked to review or reply to
 * quoted text very often reproduces it verbatim. The block then arrives in the
 * SECOND teammate's reply, where the host parses it and acts -- under the
 * second teammate's name, with nobody having asked for it.
 *
 * `peer-share.ts` has defended exactly this since peer messages existed, and
 * its comment says why. What it did not do was cover the other three tags, or
 * the places other than a peer message where model text is quoted. Found
 * 2026-09-13 reading xai-org/grok-build, whose harness tags every input with
 * an `InputAuthority` -- `HumanIntent`, `ModelAuthoredUntrusted`,
 * `RuntimeControl` -- and lets what an input is ALLOWED to do follow from
 * that. This is the small honest version of the same idea: one rule, in one
 * place, for text that is not the person's.
 *
 * Defanged rather than deleted. The reader still needs to see what was said --
 * that IS the point of quoting it -- so the angle bracket becomes a visibly
 * different character and the words survive intact.
 */
export const PROTOCOL_TAGS = ['locust-share', 'locust-memory', 'locust-ask', 'locust-task', 'locust-file'] as const

/** The mark a defanged bracket leaves. Single-width, visibly not a bracket. */
export const DEFANGED_BRACKET = '‹'

const ANY_TAG = new RegExp(`<(/?)(${PROTOCOL_TAGS.join('|')})\\b`, 'gi')

/**
 * Text from a model, made safe to quote into another model's prompt.
 *
 * Call this at every point where something a teammate SAID becomes part of
 * what another teammate is TOLD. If a new protocol tag is added, add it to
 * `PROTOCOL_TAGS` and every one of those points is covered at once -- which
 * is the whole reason this is not four regexes in four files.
 */
export function defangProtocolBlocks(text: string): string {
  return text.replace(ANY_TAG, `${DEFANGED_BRACKET}$1$2`)
}
