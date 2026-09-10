import { MAX_ROOM_TEAMMATES } from '../../shared/live-missions.js'

/**
 * Asking more than one teammate at once, from the home composer.
 *
 * The design agent's answer to "how does one create a room", 2026-09-10:
 * **a room is the consequence of the ask, not its prerequisite.** A room is
 * genuinely a place -- it has a board, a thread and a life afterwards -- and
 * that is exactly why the Rooms screen should be where you go BACK to one,
 * not the factory you must find first.
 *
 * So the home composer's contract changes by one word: *pick a teammate*
 * becomes *pick who answers*, and the set is allowed more than one member.
 * Ticking two names fans the post out and makes the room; the answers land in
 * it. Nobody has to know rooms exist in order to make their first one.
 *
 * The naming problem disappears with it, which is most of why this is worth
 * doing: today a first room costs a name before it has a purpose. Named from
 * its first post -- as every thread in every tool is -- it costs nothing.
 */

/** What a room is called before anybody has renamed it. */
export const UNTITLED_ROOM = 'Untitled room'

/**
 * `Wren`, `Wren and Atlas`, `Wren, Atlas and Juno`.
 *
 * An Oxford-less list because this is speech, not a spec: the app says these
 * names inside sentences a person reads once.
 */
export function namesInWords(names: readonly string[]): string {
  if (names.length === 0) return 'nobody'
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
}

/** The heading over the home composer: `Ask Wren`, `Ask Wren and Atlas`. */
export function askHeadline(names: readonly string[]): string {
  return names.length === 0 ? 'Ask a teammate' : `Ask ${namesInWords(names)}`
}

/**
 * The line under it.
 *
 * One teammate keeps the sentence it already had -- this is their runtime and
 * their model, and the recording is local. More than one has to say the new
 * fact, which is that the answers arrive together somewhere.
 */
export function askLede(count: number): string {
  return count > 1
    ? 'Everyone picked answers on their own runtime and model, and their answers land together in a room.'
    : 'Whatever you write is recorded locally as it runs, on this teammate’s own runtime and model.'
}

/** What the empty box says. */
export function askPlaceholder(names: readonly string[]): string {
  if (names.length === 0) return 'Write a message…'
  if (names.length === 1) return `Message ${names[0]!}…`
  return `Ask ${String(names.length)} teammates…`
}

/** The send button. */
export function askSendLabel(count: number): string {
  return count > 1 ? 'Ask all' : 'Send'
}

/**
 * What pressing send will do, said before it is pressed.
 *
 * The standing register: a quiet left rule, no icon, nothing to answer. It is
 * there because starting three conversations and creating a durable object is
 * a lot to happen from one keypress, and a person is owed the consequence
 * before the click rather than a surprise after it.
 *
 * Absent for one teammate, because sending one message to one teammate is
 * what the box has always done and narrating it would be noise.
 */
export function askConsequence(names: readonly string[], roomName: string = UNTITLED_ROOM): string | undefined {
  if (names.length < 2) return undefined
  return (
    `Start ${String(names.length)} conversations and make a room called “${roomName}” holding ` +
    `${namesInWords(names)}. You can rename it there, and post to the same group again without picking anyone.`
  )
}

/**
 * Why this set cannot be asked, when it cannot.
 *
 * The cap is the ROOM's, because a room is what the ask makes. Refused before
 * the press rather than after it: `createRoom` would fail with "A room needs
 * between 1 and 8 teammates", which is a sentence about a thing the person
 * never asked to make.
 */
export function askRefusal(count: number): string | undefined {
  if (count <= MAX_ROOM_TEAMMATES) return undefined
  return `A room holds up to ${String(MAX_ROOM_TEAMMATES)} teammates. Untick ${String(count - MAX_ROOM_TEAMMATES)} to ask the rest.`
}
