/**
 * The Missions screen's rows: one per CONVERSATION, as the sidebar has them.
 *
 * Fresh-eyes area 8/9, on 0.414 with sixteen conversations: the screen said
 * "18 conversations" beside a sidebar of 16, and listed every turn as its own
 * row -- "Good, ship it" and "Also check the signup form does the same thing"
 * stood alone, meaning nothing, two rows above the conversation they belonged
 * to. The header had already been renamed to "conversations" (0.349); the
 * rows never were.
 *
 * A conversation is a chain of `continuesFrom` links. Each is grouped under
 * the turn it started from, the ROOT, which names it; the LEAF, the turn
 * nothing continues from, is where it is now -- its phase, its route and the
 * turn that opens. The order is the input's: a conversation stands where its
 * newest turn stood.
 */
export interface ConversationEntry<TMission> {
  readonly key: string
  readonly root: TMission
  readonly leaf: TMission
  /** Every turn, oldest first. */
  readonly members: readonly TMission[]
}

interface Chained {
  readonly missionId: string
  readonly createdAt: string
  readonly continuesFrom?: { readonly missionId: string }
}

export function conversationsOf<TMission extends Chained>(missions: readonly TMission[]): readonly ConversationEntry<TMission>[] {
  const byId = new Map(missions.map((mission) => [mission.missionId, mission]))
  const rootOf = (mission: TMission): TMission => {
    let current = mission
    // A hand-edited ledger can hold a cycle; a turn seen twice ends the walk.
    const seen = new Set([mission.missionId])
    for (;;) {
      const prior = current.continuesFrom === undefined ? undefined : byId.get(current.continuesFrom.missionId)
      if (prior === undefined || seen.has(prior.missionId)) return current
      seen.add(prior.missionId)
      current = prior
    }
  }
  const order: string[] = []
  const groups = new Map<string, TMission[]>()
  for (const mission of missions) {
    const key = rootOf(mission).missionId
    const held = groups.get(key)
    if (held === undefined) {
      order.push(key)
      groups.set(key, [mission])
    } else {
      held.push(mission)
    }
  }
  return order.map((key) => {
    const members = [...(groups.get(key) ?? [])].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    const continued = new Set(members.map((mission) => mission.continuesFrom?.missionId).filter((id): id is string => id !== undefined))
    const leaf = [...members].reverse().find((mission) => !continued.has(mission.missionId)) ?? members[members.length - 1]!
    return { key, root: byId.get(key) ?? members[0]!, leaf, members }
  })
}
