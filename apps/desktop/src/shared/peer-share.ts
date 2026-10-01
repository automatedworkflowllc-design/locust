import { blocksOutsideCode, defangProtocolBlocks, stripBlocksOutsideCode } from './protocolTags.js'

/**
 * The share block: how a teammate's runtime says "another teammate needs this".
 *
 * `codex exec` and `claude -p` are one prompt in, one transcript out. There is
 * no side channel for an agent to post to, so the share decision has to travel
 * in the transcript itself, in a form the host can find without guessing. The
 * form is deliberately verbose and tag-shaped -- both runtimes produce XML-ish
 * blocks reliably, and nothing in ordinary prose looks like one.
 *
 * Only the host reads these. A block names a recipient by roster name and
 * carries a short text; the host checks the name against the roster, bounds
 * the text, attributes the message to the mission that produced it, and posts
 * it to the workroom. Nothing in the block can grant anything: it is a claim
 * from one agent to another, and it is shown as one.
 *
 * Shared between main and renderer so the parser that posts a block and the
 * one that hides it from the transcript bubble are the same function.
 */

export const SHARE_TAG = 'locust-share'
/*
 * 6,000, from 1,200 (0.486). Colin, 2026-09-30, a Boss brief to Ghost cut at
 * "prepare an optimi…" -- Ghost itself said the message was cut. 1,200 is two
 * paragraphs, and the briefing asks for a brief a senior colleague can act on.
 * 6,000 (about 1,000 words) still fits whole beside the briefing inside
 * MAX_RUNTIME_PROMPT_LENGTH, and the store takes the same (workroom.ts).
 */
export const MAX_SHARE_TEXT_LENGTH = 6_000
export const MAX_SHARES_PER_MISSION = 4

/**
 * A share block, and the two ways models reasonably get `to=` wrong.
 *
 * SINGLE QUOTES. The example is written with double quotes and this pattern
 * accepted only those, so `to='Gem'` matched nothing at all — no block, no
 * error, no share.
 *
 * THE ROLE SUFFIX. The briefing prints the roster as `Gem (Custom)` and the
 * matcher compares against the bare name, so copying the line as printed
 * produced "who is not on the roster. Nothing was sent." Reported by a Cursor
 * teammate reading this source from inside Locust (2026-09-08), which is
 * exactly how a model meets it.
 *
 * Both are the app failing to read something unambiguous. The role is stripped
 * in `parseShareBlocks` so this stays one expression.
 */
const BLOCK = /<locust-share\s+([^<>]{1,200}?)\s*>([\s\S]*?)<\/locust-share>/g

/**
 * One attribute of an open tag, either quoting style.
 *
 * The open tag is read as attributes rather than as one fixed shape because
 * there is now more than one of them, and a model that writes them in the
 * other order is not making a mistake. `to=` is still the only required one;
 * a block without it is dropped exactly as before.
 */
const ATTRIBUTE = /([a-z-]{1,20})=(?:"([^"<>\n]{0,60})"|'([^'<>\n]{0,60})')/gi

function attributesOf(openTag: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const match of openTag.matchAll(ATTRIBUTE)) {
    found[(match[1] ?? '').toLowerCase()] = match[2] ?? match[3] ?? ''
  }
  return found
}

/** `Gem (Custom)` → `Gem`. The roster prints the role; the parser wants the name. */
function withoutRole(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, '').trim()
}

export interface ShareBlock {
  readonly to: string
  readonly text: string
  /**
   * `when="later"`: the sender is telling, not asking.
   *
   * A share starts a RUN on the recipient -- a whole mission, on their
   * route, costing whatever that costs. Right for "the person asked you to
   * hand this to Wren"; wrong for "here are the version notes you wanted",
   * and until now there was no way to say which.
   *
   * Found from inside a room, 2026-09-15, by a Cursor teammate dogfooding
   * the app: "Telling a teammate anything starts a paid mission... Locust
   * auto-replied him into my thread with 'confirmed, no help needed.' Each
   * of those is another run. FYI shares should not page a model."
   *
   * Deferring is not a new delivery path. It is the one a spent hop budget
   * or a switched-off relay already takes -- the message waits and is read
   * on the recipient's next run -- so this can only decline to interrupt,
   * never lose anything.
   */
  readonly defer?: boolean
  /**
   * `when="now"`: the sender is asking for this to be taken before the
   * recipient finishes what they are doing.
   *
   * A request, never a power. What the host does with it depends on a switch
   * the person owns, and the ordinary answer -- wait for their run to end --
   * is what happens when the switch is off. The whole reason it exists is
   * that the common urgent message is "stop, I am editing that file", and
   * delivering it after the conflicting work is done delivers it too late.
   */
  readonly urgent: boolean
  /**
   * The sender wants an answer back (A2.1): `wants="answer"`, or a message
   * that ends by asking. If the recipient answers in their own conversation
   * and does not write back, the host brings the answer to the sender.
   */
  readonly wantsAnswer?: boolean
}

/** Complete, well-formed blocks in transcript order. Empty bodies are dropped. */
export function parseShareBlocks(text: string): readonly ShareBlock[] {
  const blocks: ShareBlock[] = []
  for (const match of blocksOutsideCode(text, BLOCK)) {
    const attributes = attributesOf(match[1] ?? '')
    const to = withoutRole(attributes.to ?? '')
    const body = (match[2] ?? '').trim()
    if (to.length === 0 || body.length === 0) continue
    // Exactly one word means it, so a model reaching for emphasis with
    // `when="soon"` or `when="urgent"` gets the ordinary treatment rather
    // than an interruption it did not know it was asking for.
    const when = (attributes.when ?? '').trim().toLowerCase()
    // Exactly one word means it, in both directions: a model reaching for
    // emphasis with `when="soon"` gets the ordinary treatment rather than an
    // interruption, and one reaching for `when="whenever"` still pages.
    const wantsAnswer = (attributes.wants ?? '').trim().toLowerCase() === 'answer' || /\?\s*$/.test(body)
    blocks.push({
      to,
      text: body,
      urgent: when === 'now',
      ...(when === 'later' ? { defer: true } : {}),
      ...(wantsAnswer ? { wantsAnswer: true } : {})
    })
  }
  return blocks
}

/**
 * The transcript without its share blocks. What was shared is shown in the
 * peer card, attributed and labelled; showing it a second time inside the
 * agent's bubble would present the same claim twice, once unlabelled.
 */
export function stripShareBlocks(text: string): string {
  return stripBlocksOutsideCode(text, BLOCK).replace(/\n{3,}/g, '\n\n').trimEnd()
}

/**
 * A received message is quoted into another agent's prompt. Defang the tags
 * so a message cannot carry a block that the recipient's runtime could echo
 * back verbatim and have acted on under ITS name. The text stays readable:
 * the angle bracket becomes a visibly different one.
 *
 * This defended `locust-share` alone until 2026-09-13, which left the other
 * three -- a quoted message carrying `<locust-memory>` could be echoed by the
 * recipient and written to the team's memory. `defangProtocolBlocks` covers
 * every tag the host parses, so adding a fifth tag cannot leave this behind.
 */
export function sanitizeInbound(text: string): string {
  return defangProtocolBlocks(text)
}

/**
 * Text as the workroom will accept it. Control characters other than line
 * breaks and tabs are refused by the store, so they are removed here rather
 * than letting a stray byte from a transcript refuse the whole share. The
 * bound is a hard cut with a marker, never a silent truncation.
 */
export function boundedShareText(text: string): string {
  const clean = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (clean.length <= MAX_SHARE_TEXT_LENGTH) return clean
  return `${clean.slice(0, MAX_SHARE_TEXT_LENGTH - 1)}…`
}
