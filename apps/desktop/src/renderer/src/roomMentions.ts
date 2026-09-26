/**
 * ASK ONE TEAMMATE IN A ROOM (0.371).
 *
 * A post asked everyone in the room, so "Wren, say more about your second
 * point" ran every member, each answering a question meant for one. Open
 * WebUI's channels and Buzz both answer only the agent that is @-mentioned;
 * everyone stays the default here, and naming someone narrows it
 * (docs/RESEARCH-2026-09-26-ROOMS-AND-PEERS.md).
 *
 * Two ways to name someone, one result. Reply on an answer puts that teammate
 * in the box; typing @ opens the room's members in the menu the main box
 * uses for commands. Either way the teammate becomes a tile in the box, the
 * way an attached file does -- the one place the person looks to see where a
 * message is going -- and the @ they typed leaves the text. Nothing is read
 * out of the words at send: what the tiles say is what is asked.
 */

/** The @-word being typed at the caret: where its @ is, and what follows it. */
export interface Mention {
  readonly start: number
  readonly query: string
}

/**
 * The @-word the caret is in, if it is in one.
 *
 * Only at the start of the text or after a space, so an address like
 * `pip@example.com` never opens the menu; and only up to the caret, so going
 * back to fix a word earlier in the line does not either.
 */
export function mentionAt(text: string, caret: number): Mention | undefined {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (match === null) return undefined
  const query = match[1] ?? ''
  return { start: before.length - query.length - 1, query }
}

export interface MentionMember {
  readonly teammateId: string
  readonly name: string
}

/** Who an @ can name: members not already asked, by the start of their name, in the room's order. */
export function mentionChoices<Member extends MentionMember>(
  members: readonly Member[],
  asked: readonly string[],
  query: string
): readonly Member[] {
  const wanted = query.toLowerCase()
  return members.filter((member) => !asked.includes(member.teammateId) && member.name.toLowerCase().startsWith(wanted))
}

/** The text with the @-word taken out, and where the caret goes. */
export function withoutMention(text: string, mention: Mention): { readonly text: string; readonly caret: number } {
  const head = text.slice(0, mention.start)
  let tail = text.slice(mention.start + 1 + mention.query.length)
  // One space is enough between the words either side of it, and none at the start.
  if ((head.length === 0 || head.endsWith(' ')) && tail.startsWith(' ')) tail = tail.slice(1)
  return { text: head + tail, caret: head.length }
}

/**
 * The member whose whole name was just typed after an @, when a space or the
 * end of a word follows it -- so "@Wren " becomes the tile without the menu.
 * Case-insensitive; a name that is only the start of another's is not enough.
 */
export function mentionCompleted<Member extends MentionMember>(
  members: readonly Member[],
  asked: readonly string[],
  text: string,
  caret: number
): { readonly member: Member; readonly mention: Mention } | undefined {
  if (caret < 1 || text[caret - 1] !== ' ') return undefined
  const mention = mentionAt(text, caret - 1)
  if (mention === undefined || mention.query.length === 0) return undefined
  const member = members.find((candidate) => !asked.includes(candidate.teammateId) && candidate.name.toLowerCase() === mention.query.toLowerCase())
  return member === undefined ? undefined : { member, mention }
}

/** "Wren", "Wren and Pip", "Wren, Pip and Booty". */
export function namesSaid(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
}
