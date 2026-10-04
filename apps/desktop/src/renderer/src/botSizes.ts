/**
 * HOW BIG A TEAMMATE IS DRAWN, EVERYWHERE, IN ONE PLACE (0.561).
 *
 * Colin, 2026-10-03, after the screen faces and the moving code eyes: "we
 * might have to make them a little bigger now that i keep having you add
 * these assets ... some may have to be bigger than others". A face now
 * carries a screen and two lit glyphs that type, glance and bounce, and at
 * the old sizes the thread's "Thinking..." face was a smudge beside its orb.
 * The sizes were literals in a dozen files; they are named here by what the
 * bot is doing on that surface, so a surface can be tuned without hunting.
 *
 * Two kinds, sized differently on purpose:
 * - A PRESENCE: the teammate itself, the thing you look at to see what it is
 *   doing -- the thread's live row, the workroom header, a roster card, a
 *   room's answers. Big enough for its eyes to be read: 28 and up.
 * - A MARK: a face beside a name in a list or a picker, saying who. Small,
 *   but no longer a speck: 18 to 22.
 */
export const BOT_SIZE = {
  /** The thread's live row: "Thinking...", the step it is on. Its orb stays 20. */
  threadLive: 34,
  /** The workroom header, beside the teammate's name. */
  workroomHeader: 40,
  /** A card on the Team screen. */
  rosterCard: 44,
  /** The sidebar's row of faces under Conversations / Rooms / Routines. */
  sidebarFaces: 32,
  /** A teammate's row in the collapsed sidebar rail. */
  railRow: 34,
  /** A room's answer, beside who gave it. */
  roomAnswer: 30,
  /** A face in a room post's row of who answered, beside its pip. */
  postFace: 26,
  /** A line a teammate said in a room. */
  roomSaid: 28,
  /** Who a message between teammates came from. */
  peerOrigin: 26,
  /** The toggle that opens the messages between teammates. */
  peerToggle: 20,
  /** Who owns a conversation, in the sidebar's list. */
  conversationOwner: 20,
  /** A teammate in a picker, a mention list, a task's owner line. */
  pickerMark: 20,
  /** A teammate tile in an "ask" or attach row. */
  tileMark: 18,
  /** The author of a memory. */
  memoryAuthor: 18,
  /** A routine's teammate, in its row. */
  routineRow: 22,
  /** A saved routine's card. */
  savableRow: 20,
  /** The teammate a side conversation is with, in its head. */
  besideHead: 22
} as const
