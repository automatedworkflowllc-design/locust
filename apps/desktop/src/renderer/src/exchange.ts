import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicPeerMessage } from '../../shared/ipc.js'
import { runCostOf, sumCosts } from './cost.js'
import type { RunCost } from './cost.js'

/**
 * The exchange a conversation is part of: who is in it, on what, how many
 * automatic replies it has used of its allowance, and what it has cost.
 *
 * The tester on 0.21.2 (rec. 6): "six hops is a useful backstop, but it is
 * not a user-controlled time/spend budget", and nothing on screen said how
 * far along an exchange was or what it had spent. Everything here is read
 * from records the window already holds -- missions linked by the workroom
 * messages they posted and received -- so the overview is the record's own
 * account, not a second bookkeeping that could drift from it.
 */

export interface ExchangeMission {
  readonly missionId: string
  readonly runtime: string
  readonly model: string
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly peerMessages: readonly PublicPeerMessage[]
  readonly startedBy?: { readonly kind: 'relay'; readonly hop: number } | { readonly kind: string }
  /** Who owns it, when the window knows. */
  readonly teammateId?: string
  readonly teammateName?: string
  /** True while its run is still going. */
  readonly live: boolean
  readonly runId?: string
}

export interface ExchangeParticipant {
  readonly teammateId: string
  readonly name: string
  readonly runtime: string
  readonly model: string
  readonly missionIds: readonly string[]
  readonly live: boolean
}

export interface ExchangeOverview {
  readonly participants: readonly ExchangeParticipant[]
  /** The deepest automatic reply in the exchange so far. */
  readonly hops: number
  readonly cost: RunCost | undefined
  /** Runs still going anywhere in the exchange. */
  readonly liveRunIds: readonly string[]
  readonly missionIds: readonly string[]
}

/**
 * Every mission reachable from `missionId` through a shared workroom
 * message: a message one mission POSTED and another RECEIVED is the same
 * message id on both records, which is the only link the record keeps.
 */
export function exchangeOf(missionId: string, missions: readonly ExchangeMission[]): ExchangeOverview | undefined {
  const byId = new Map(missions.map((mission) => [mission.missionId, mission]))
  const root = byId.get(missionId)
  if (root === undefined) return undefined

  // Which missions carry which message ids.
  const byMessage = new Map<string, ExchangeMission[]>()
  for (const mission of missions) {
    for (const message of mission.peerMessages) {
      const holders = byMessage.get(message.messageId) ?? []
      holders.push(mission)
      byMessage.set(message.messageId, holders)
    }
  }

  const reached = new Map<string, ExchangeMission>()
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (reached.has(current.missionId)) continue
    reached.set(current.missionId, current)
    for (const message of current.peerMessages) {
      for (const other of byMessage.get(message.messageId) ?? []) {
        if (!reached.has(other.missionId)) queue.push(other)
      }
    }
  }

  // One conversation talking to nobody is not an exchange.
  const members = [...reached.values()]
  const talked = members.some((mission) => mission.peerMessages.length > 0)
  if (!talked) return undefined

  const participants = new Map<string, { name: string; runtime: string; model: string; missionIds: string[]; live: boolean }>()
  for (const mission of members) {
    // A mission of nobody's still takes part; it is named by what it is.
    const key = mission.teammateId ?? `nobody:${mission.missionId}`
    const name = mission.teammateName ?? (mission.teammateId === undefined ? 'Nobody' : mission.teammateId)
    const entry = participants.get(key) ?? { name, runtime: mission.runtime, model: mission.model, missionIds: [], live: false }
    entry.missionIds.push(mission.missionId)
    // The route they are on NOW is the one their latest mission ran on.
    entry.runtime = mission.runtime
    entry.model = mission.model
    entry.live = entry.live || mission.live
    participants.set(key, entry)
  }

  let hops = 0
  for (const mission of members) {
    if (mission.startedBy?.kind === 'relay' && 'hop' in mission.startedBy) {
      hops = Math.max(hops, mission.startedBy.hop)
    }
  }

  return {
    participants: [...participants.entries()].map(([teammateId, entry]) => ({ teammateId, ...entry })),
    hops,
    cost: sumCosts(members.map((mission) => runCostOf(mission.events))),
    liveRunIds: members.filter((mission) => mission.live && mission.runId !== undefined).map((mission) => mission.runId!),
    missionIds: members.map((mission) => mission.missionId)
  }
}
