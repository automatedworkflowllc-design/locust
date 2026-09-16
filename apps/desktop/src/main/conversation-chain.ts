import type { PublicGroup } from '../shared/ipc.js'
import type { GroupMembership } from './group-store.js'

/**
 * Which conversation a run belongs to, from inside the host.
 *
 * The renderer knows a conversation as a row with every turn's id on it. The
 * host, at the moment a turn starts, knows only the turn it continues from:
 * `continuesFrom`, or the follow-up id. Group membership is written against
 * the conversation's ROOT (and read tolerantly against any id it has worn),
 * so briefing a turn with its group's instructions means walking back from
 * the previous turn to the root and asking the group store about each id.
 *
 * Each hop is one ledger read, so the parent of every id seen is remembered
 * for the life of the process: a long conversation pays for its chain once.
 */

export interface ChainReader {
  getMission(missionId: string): Promise<
    { readonly metadata: { readonly missionId: string; readonly continuesFrom?: { readonly missionId: string } } } | undefined
  >
}

/** Past this a chain is not walked further; nothing real is this deep. */
export const MAX_CHAIN_HOPS = 64

export interface ConversationChain {
  /**
   * Every id this conversation has worn at or before `missionId`, newest
   * first. Empty when there is no previous turn. A read that fails, or a turn
   * that is gone, ends the walk where it stands rather than guessing.
   */
  keysBefore(missionId: string | undefined): Promise<readonly string[]>
}

export function createConversationChain(reader: ChainReader): ConversationChain {
  const parents = new Map<string, string | undefined>()
  const parentOf = async (missionId: string): Promise<string | undefined> => {
    if (parents.has(missionId)) return parents.get(missionId)
    let parent: string | undefined
    try {
      parent = (await reader.getMission(missionId))?.metadata.continuesFrom?.missionId
    } catch {
      // Unknown, and NOT remembered as "none": the next start asks again.
      return undefined
    }
    parents.set(missionId, parent)
    return parent
  }
  return {
    async keysBefore(missionId) {
      const keys: string[] = []
      const seen = new Set<string>()
      let current = missionId
      while (current !== undefined && !seen.has(current) && keys.length < MAX_CHAIN_HOPS) {
        keys.push(current)
        seen.add(current)
        current = await parentOf(current)
      }
      return keys
    }
  }
}

/**
 * The group this conversation is in, when that group has instructions.
 *
 * Reads tolerantly, the way the sidebar's `heldFor` does: the first id in
 * the chain with a membership wins, which is the root when the chain is
 * whole and the nearest surviving turn when it is not. A group with empty
 * instructions is an ordinary folder and briefs nothing.
 */
export function groupBriefFor(
  keys: readonly string[],
  listed: { readonly groups: readonly PublicGroup[]; readonly members: Readonly<Record<string, GroupMembership>> }
): { readonly name: string; readonly instructions: string } | undefined {
  for (const key of keys) {
    const held = listed.members[key]
    if (held === undefined) continue
    const group = listed.groups.find((entry) => entry.groupId === held.groupId)
    if (group === undefined) continue
    const instructions = group.instructions.trim()
    return instructions.length === 0 ? undefined : { name: group.name, instructions }
  }
  return undefined
}
