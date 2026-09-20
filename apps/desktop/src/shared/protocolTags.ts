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

/**
 * A protocol tag in its loosest possible form: the name, anything that is not
 * another tag, a close bracket. Deliberately looser than any of the five
 * parsers.
 */
// `\\b`, not `\b`: inside a template literal `\b` is the BACKSPACE character,
// not a word boundary, and the pattern then matches nothing at all — silently,
// because it is still a perfectly valid regex.
const LOOSE_TAG = new RegExp(`</?(?:${PROTOCOL_TAGS.join('|')})\\b[^<>]{0,400}>`, 'gi')

/** Fenced blocks and inline spans, which are quoted source and stay intact. */
const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g

/**
 * The last thing done to a reply before a person reads it: take the tags off
 * anything still wearing them.
 *
 * WHY THIS EXISTS. Each of the five parsers is strict, and each has a matching
 * stripper built from the SAME strict pattern -- so a block the parser will
 * not act on is also a block the stripper will not hide. Those two facts
 * multiply into the worst possible pair: the message goes nowhere AND the
 * person is shown the plumbing.
 *
 * Colin, 2026-09-20, with a photograph of a bubble reading
 * `<locust-share>Booty :: Reply with exactly the word PEBBLE-6725...`: "bug i
 * think". A bare open tag -- no `to=` -- which `parseShareBlocks` drops and
 * the share stripper's `\s+` never matched. The same hole is in the other
 * four from the opposite side: they accept no attributes at all, so
 * `<locust-memory scope="team">` leaks exactly as loudly.
 *
 * UNWRAP, DO NOT DELETE. The strippers delete because their block was ACTED
 * ON -- it is already a peer card, a memory entry, a decision. Nothing acted
 * on this one, so its body is the only copy of what the teammate said, and
 * deleting it would trade a visible defect for a silent one. The tags come
 * off; the words stay, as ordinary prose the person can read and forward.
 *
 * Unpaired tags are handled by not caring about pairs. A turn cut off
 * mid-block leaves an open tag with no close, which is the case a
 * block-shaped pattern gets wrong and this gets right for free.
 *
 * CODE IS LEFT ALONE. A teammate reading this repo from inside Locust and
 * explaining the protocol writes these tags ON PURPOSE, in a fence, and that
 * is not plumbing -- it is the answer. It happens here often enough to be in
 * these comments twice already.
 */
export function unwrapProtocolTags(text: string): string {
  let out = ''
  let at = 0
  for (const span of text.matchAll(CODE)) {
    const index = span.index ?? 0
    out += text.slice(at, index).replace(LOOSE_TAG, '')
    out += span[0]
    at = index + span[0].length
  }
  out += text.slice(at).replace(LOOSE_TAG, '')
  /*
   * Leading blank LINES, not leading whitespace. A tag on its own first line
   * leaves the bubble starting on an empty one, which reads as a gap the
   * teammate left. `trim()` would also eat the indentation of a message that
   * opens with an indented code block, and that indentation is content.
   */
  return out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd()
}
