/**
 * TAG A TEAMMATE FROM ANY CONVERSATION (0.438).
 *
 * Colin, 2026-09-28: "can we tag teammates from any conversation? i saw you
 * added that in rooms but it should be doable from anywhere honestly." In a
 * room an @ narrows a post to who is named (0.371, roomMentions.ts). In a
 * conversation with one teammate, a tag LOOPS SOMEONE IN: the message still
 * goes to the teammate on screen, and each teammate tagged is sent it too,
 * in a conversation of their own, with where it came from. With nobody on
 * screen (Home), the tags are who it goes to.
 *
 * The person's words come FIRST, so the tagged conversation is titled by
 * them; the note of where it came from, and that conversation's latest
 * answer, follow -- fitted to the mission's limit.
 */
export const MAX_TAGGED = 5
const LIMIT = 8_000
const OVERHEAD = 200
const CONTEXT_MARK = '\n\n(You were tagged in '

/**
 * The person's words of a tagged prompt, without the context after them. The
 * ledger records a tagged run as an ordinary one, so after a restart this is
 * what keeps the note and the quoted answer out of the bubble and the title.
 */
export function taggedWordsOf(prompt: string): string {
  const at = prompt.indexOf(CONTEXT_MARK)
  return at < 0 ? prompt : prompt.slice(0, at)
}

export function taggedPrompt(input: {
  /** What the person sent, attachments line included. */
  readonly message: string
  /** Whose conversation it was sent in, when it was one. */
  readonly fromName?: string
  /** That conversation's latest answer, for context. */
  readonly answer?: string
}): string {
  if (input.fromName === undefined) return input.message
  const answer = (input.answer ?? '').trim()
  const room = Math.max(0, LIMIT - input.message.length - OVERHEAD)
  const quoted = answer.length <= room ? answer : `${answer.slice(0, Math.max(0, room - 60)).trimEnd()}\n... (cut short here)`
  const where = `${CONTEXT_MARK}${input.fromName}'s conversation.`
  return answer.length === 0 || room === 0
    ? `${input.message}${where})`
    : `${input.message}${where} ${input.fromName}'s latest answer there, for context:)\n\n${quoted}`
}
