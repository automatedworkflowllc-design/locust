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
export const MAX_SHARE_TEXT_LENGTH = 1_200
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
const BLOCK = /<locust-share\s+to=(?:"([^"<>\n]{1,60})"|'([^'<>\n]{1,60})')\s*>([\s\S]*?)<\/locust-share>/g

/** `Gem (Custom)` → `Gem`. The roster prints the role; the parser wants the name. */
function withoutRole(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, '').trim()
}

export interface ShareBlock {
  readonly to: string
  readonly text: string
}

/** Complete, well-formed blocks in transcript order. Empty bodies are dropped. */
export function parseShareBlocks(text: string): readonly ShareBlock[] {
  const blocks: ShareBlock[] = []
  for (const match of text.matchAll(BLOCK)) {
    const to = withoutRole(match[1] ?? match[2] ?? '')
    const body = (match[3] ?? '').trim()
    if (to.length === 0 || body.length === 0) continue
    blocks.push({ to, text: body })
  }
  return blocks
}

/**
 * The transcript without its share blocks. What was shared is shown in the
 * peer card, attributed and labelled; showing it a second time inside the
 * agent's bubble would present the same claim twice, once unlabelled.
 */
export function stripShareBlocks(text: string): string {
  return text.replace(BLOCK, '').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/**
 * A received message is quoted into another agent's prompt. Defang the tag
 * so a message cannot carry a share block that the recipient's runtime could
 * echo back verbatim and have posted under ITS name. The text stays readable:
 * the angle bracket becomes a visibly different one.
 */
export function sanitizeInbound(text: string): string {
  return text.replace(/<(\/?)locust-share/gi, '‹$1locust-share')
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
