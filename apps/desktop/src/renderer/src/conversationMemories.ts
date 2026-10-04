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
  /** Who wrote its current wording, when it was rewritten (A1.6). */
  readonly updatedBy?: { readonly name: string }
  readonly text: string
  readonly status: 'kept' | 'proposed'
  /** Present when this memory has been rewritten under its name; what it said before. */
  readonly previousText?: string
  /** A proposal to change, or to forget, a kept memory (0.315), or to merge some (A1.2). */
  readonly replaces?: string
  readonly forgets?: string
  readonly merges?: readonly string[]
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
  /** A proposal to change, forget or merge kept memories, not a new one (0.315, A1.2). */
  readonly change?: 'rewrite' | 'forget' | 'merge'
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
      by: (memory.updatedBy ?? memory.by).name,
      text: memory.text,
      status: memory.status,
      missionId: memory.missionId!,
      ...(memory.previousText === undefined ? {} : { updated: true }),
      ...(memory.merges !== undefined
        ? { change: 'merge' as const }
        : memory.forgets !== undefined
          ? { change: 'forget' as const }
          : memory.replaces !== undefined
            ? { change: 'rewrite' as const }
            : {})
    }))
}

/**
 * What the Memory screen's notice says about one reply's memory changes, or
 * nothing when nothing happened worth reporting.
 *
 * Every list empty is `undefined`, not '': `[].join()` is '', which passes
 * `!== undefined` downstream and drew an empty paragraph that then also could
 * not be dismissed.
 *
 * Sentences, not a join: a memory is usually a sentence, and '. ' after its
 * closing quote printed `...Thursdays.". Booty wants...` (seen on the 0.315
 * drive). A clause already ended inside its quote is left as it is.
 */
export function memoryChangedNotice(update: {
  readonly by: string
  readonly kept: readonly string[]
  readonly proposed: readonly string[]
  readonly forgotten: readonly string[]
  readonly rewritten?: readonly string[]
  readonly proposedChanges?: readonly string[]
  readonly proposedForgets?: readonly string[]
  readonly proposedTidy?: number
  readonly tidyRefused?: readonly string[]
  readonly aboutYouSuggested?: readonly string[]
}): string | undefined {
  const quoted = (texts: readonly string[]): string => texts.map((text) => `"${text}"`).join('; ')
  const said: string[] = []
  if (update.kept.length > 0) said.push(`${update.by} remembered ${quoted(update.kept)}`)
  if (update.proposed.length > 0) said.push(`${update.by} wants to remember ${quoted(update.proposed)}`)
  if (update.forgotten.length > 0) said.push(`${update.by} forgot ${quoted(update.forgotten)}`)
  // A memory that CHANGED, named as a change. It replaced something the
  // person may already have read, which is worth more than a new one.
  if ((update.rewritten ?? []).length > 0) said.push(`${update.by} updated ${quoted(update.rewritten ?? [])}`)
  // "Ask me first" changes, waiting on this screen (0.315).
  if ((update.proposedChanges ?? []).length > 0) said.push(`${update.by} wants to change a memory to ${quoted(update.proposedChanges ?? [])}`)
  if ((update.proposedForgets ?? []).length > 0) said.push(`${update.by} wants to forget ${quoted(update.proposedForgets ?? [])}`)
  // A tidy pass's suggestions, waiting on this screen, and any it could not make (A1.2).
  const tidy = update.proposedTidy ?? 0
  if (tidy > 0) said.push(`${update.by} suggested ${String(tidy)} change${tidy === 1 ? '' : 's'} to memory, waiting below`)
  const refused = update.tidyRefused ?? []
  if (refused.length > 0) said.push(`${String(refused.length)} could not be made: ${refused.join(' ')}`)
  // A line for the person's own note, waiting for them whatever the mode (0.424).
  if ((update.aboutYouSuggested ?? []).length > 0) said.push(`${update.by} suggests adding to About you: ${quoted(update.aboutYouSuggested ?? [])}`)
  if (said.length === 0) return undefined
  return said.map((clause) => (/[.!?]"?$/.test(clause) ? clause : `${clause}.`)).join(' ')
}

/**
 * Whether that notice points at something waiting on the Memory screen.
 *
 * "Wren suggested 2 changes to memory, waiting below" stayed at the top of
 * the screen after both were answered -- a sentence about the past, still
 * pointing at a section that was gone (drive-memory-tidy on 0.371). A notice
 * like that goes once nothing is waiting: what was kept is in the list, and
 * what was forgotten is under Recently forgotten.
 */
export function noticeWaits(update: Parameters<typeof memoryChangedNotice>[0]): boolean {
  return update.proposed.length + (update.proposedChanges ?? []).length + (update.proposedForgets ?? []).length + (update.proposedTidy ?? 0) + (update.aboutYouSuggested ?? []).length > 0
}
