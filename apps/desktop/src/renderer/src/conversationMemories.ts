/**
 * What a CONVERSATION taught the team, not what one turn did.
 *
 * Colin, 2026-09-10: "after an agent 'remembers something' it disappears in
 * chat, might be worth keeping that around for the user to see."
 *
 * It was not a rendering problem. A reply is its own mission -- one run, one
 * receipt -- so a thread you have replied in twice is three missions wearing
 * one row. The memory card matched `memory.missionId` against the mission the
 * workroom happens to be showing, which is the LAST turn; a memory saved on
 * turn one stopped matching the moment turn two started, and the card
 * vanished from a conversation whose memories were all still there.
 *
 * The sidebar already knows the turns of a conversation -- `memberIds` -- and
 * the header's Delete already had to learn this exact lesson: it deleted the
 * shown turn and left the row, which read as the control doing nothing
 * (Colin, 2026-09-05). Same fix, one layer up.
 */

export interface ConversationMemory {
  readonly missionId?: string
  readonly by: { readonly name: string }
  readonly text: string
  readonly status: 'kept' | 'proposed'
  /** Present when this memory has been rewritten under its name; what it said before. */
  readonly previousText?: string
}

export interface MemoryLine {
  readonly by: string
  readonly text: string
  readonly status: 'kept' | 'proposed'
  /**
   * This memory REPLACED an earlier one filed under the same name, rather
   * than being a new fact. Read off the record -- a memory that has been
   * rewritten keeps what it used to say -- so the card can say "updated"
   * without the live update that announced it still being in hand.
   */
  readonly updated?: boolean
  /**
   * The turn it was learned on, kept so the card can sit THERE.
   *
   * Colin, 2026-09-11: "the remembered tab should stay at where the memory
   * happened, not permanently at the bottom." It was dropped here and the
   * thread drew one card at the foot of the conversation, so a memory from
   * turn one appeared under turn five -- reading as something the last reply
   * had just done.
   */
  readonly missionId: string
}

/**
 * Every turn of the conversation the shown mission belongs to.
 *
 * Falls back to the shown mission alone, which is what a single-run mission
 * is anyway -- and is also the honest answer while the sidebar has not caught
 * up with a conversation that started a moment ago.
 */
export function turnsOfConversation(
  shownMissionId: string | undefined,
  rows: readonly { readonly missionId: string; readonly memberIds?: readonly string[] }[]
): ReadonlySet<string> {
  if (shownMissionId === undefined) return new Set()
  const row = rows.find((entry) => (entry.memberIds ?? [entry.missionId]).includes(shownMissionId))
  return new Set(row?.memberIds ?? [shownMissionId])
}

/**
 * The memory lines belonging to a conversation, oldest first.
 *
 * Order is the order they were learned, which is the order the turns
 * happened, so a card opened on a long conversation reads as a history rather
 * than as a set.
 */
export function memoriesOfTurn(
  lines: readonly MemoryLine[],
  missionId: string | undefined
): readonly MemoryLine[] {
  return missionId === undefined ? [] : lines.filter((line) => line.missionId === missionId)
}


export function memoriesOfConversation(
  memories: readonly ConversationMemory[],
  turns: ReadonlySet<string>
): readonly MemoryLine[] {
  if (turns.size === 0) return []
  return memories
    .filter((memory) => memory.missionId !== undefined && turns.has(memory.missionId))
    .map((memory) => ({
      by: memory.by.name,
      text: memory.text,
      status: memory.status,
      missionId: memory.missionId!,
      ...(memory.previousText === undefined ? {} : { updated: true })
    }))
}
