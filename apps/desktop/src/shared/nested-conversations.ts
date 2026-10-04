/**
 * A CONVERSATION A TEAMMATE STARTED FOR ANOTHER SITS UNDER THE ONE IT CAME
 * FROM (0.463; Devin draws sub-sessions as a tree in its sidebar).
 *
 * When Wren shares a message with Juno, Juno's reply runs in a conversation
 * of its own, and the sidebar listed it as a stranger beside the conversation
 * that asked: "Wren asked: ...", a row with no line back to where it came
 * from. Its first message names the conversation it was sent from, so it can
 * be drawn under that one.
 *
 * One level, and only under a row that is not itself nested: a chain of
 * replies between two teammates can point both ways, and a rule that let a
 * nested row hold children could hide both of them under each other. A row
 * whose parent is not listed -- deleted, filtered out by a search, in another
 * folder -- stays where it always was.
 */
export function nestedUnder<Row extends { readonly missionId: string; readonly memberIds?: readonly string[] }>(
  rows: readonly Row[],
  /** The conversation (any turn of it) each row was sent from, when it was. */
  sentFrom: (row: Row) => string | undefined
): ReadonlyMap<string, string> {
  const owner = new Map<string, string>()
  for (const row of rows) for (const id of row.memberIds ?? [row.missionId]) owner.set(id, row.missionId)
  const wanted = new Map<string, string>()
  for (const row of rows) {
    const from = sentFrom(row)
    const parent = from === undefined ? undefined : owner.get(from)
    if (parent !== undefined && parent !== row.missionId) wanted.set(row.missionId, parent)
  }
  // Only under a parent that is not itself nested: one level, no cycles.
  const nested = new Map<string, string>()
  for (const [child, parent] of wanted) if (!wanted.has(parent)) nested.set(child, parent)
  return nested
}
