import type { ExchangeMission } from './exchange.js'
import type { RunCost } from './cost.js'

/**
 * A post that became a conversation, in the order it was said.
 *
 * The design agent's ruling, 2026-09-11, answering where an exchange goes in
 * a room: nowhere, because **a grid is a claim** -- these arrived in
 * parallel, and none is a reply to another. That claim is true for
 * independent answers and false the instant message three answers message
 * two. So the exchange is not housed beside the grid; a post that produced
 * one stops being a grid and becomes a sequence, first answers included.
 *
 * One prop, two results. `sequenceOfPost` returns nothing when a post
 * produced no exchange, and the room keeps the cards it has.
 *
 * The other half of the ruling is that ABSENCE IS INFORMATION. A turn that
 * ended without a reply, and a member still waiting for a slot, are drawn in
 * the sequence where they happened -- drop them and the reader watches the
 * argument stop and blames the budget.
 */

/** One thing said, or one silence, in the order it happened. */
export type RoomExchangeItem =
  | {
      readonly kind: 'said'
      readonly key: string
      readonly teammateId: string
      readonly name: string
      readonly text: string
      readonly at: string | undefined
      readonly missionId: string
      /**
       * Shown only where it is load-bearing: a message that arrived after a
       * LATER post exists looks like it was inserted into the past, because
       * it sits under the older post and above a newer one. The record is
       * right; this is the disambiguator (design agent, 2026-09-11).
       */
      readonly showTime: boolean
      /** First of a run by one speaker: consecutive messages share a face. */
      readonly startsSpeaker: boolean
    }
  | {
      readonly kind: 'silent'
      readonly key: string
      readonly teammateId: string
      readonly name: string
      readonly missionId: string
    }
  | {
      readonly kind: 'waiting'
      readonly key: string
      readonly teammateId: string
      readonly name: string
    }

export interface RoomExchangeFoot {
  readonly hops: number
  readonly cap: number
  readonly cost: RunCost | undefined
  /**
   * Why it stopped, or undefined while it is still going -- in which case the
   * same line reads as a runway indicator rather than an ending.
   */
  readonly ending: 'out-of-replies' | undefined
}

export interface RoomExchange {
  readonly items: readonly RoomExchangeItem[]
  readonly foot: RoomExchangeFoot
}

export interface PostForExchange {
  readonly postId: string
  readonly at: string
  /** teammateId -> the mission that answered. */
  readonly missions: Readonly<Record<string, string>>
  /** Members still waiting for a slot, in the order they will get one. */
  readonly waiting?: readonly string[]
}

export interface SequenceInput {
  readonly post: PostForExchange
  /** Every mission the window knows about, by id. */
  readonly missions: ReadonlyMap<string, ExchangeMission>
  /** The missions reached from this post's own, including relay replies. */
  readonly reached: readonly string[]
  /** What each mission finally said, already stripped of blocks. */
  readonly textOf: (missionId: string) => string | undefined
  /** When each mission started, for ordering. */
  readonly startedAtOf: (missionId: string) => string | undefined
  /** Whether that mission's run has finished. */
  readonly finishedOf: (missionId: string) => boolean
  readonly nameOf: (teammateId: string) => string
  /** Posts newer than this one, so a late message can be told from an early one. */
  readonly laterPostAt: string | undefined
  readonly hops: number
  readonly cap: number
  readonly cost: RunCost | undefined
}

/**
 * Whether this post is a conversation at all.
 *
 * More missions than the post itself started means somebody replied to
 * somebody: the post asked N members and produced more than N runs.
 */
export function postBecameAnExchange(post: PostForExchange, reached: readonly string[]): boolean {
  return reached.length > Object.keys(post.missions).length
}

export function sequenceOfPost(input: SequenceInput): RoomExchange | undefined {
  const { post, reached } = input
  if (!postBecameAnExchange(post, reached)) return undefined

  const ownerOf = new Map<string, string>()
  for (const [teammateId, missionId] of Object.entries(post.missions)) ownerOf.set(missionId, teammateId)

  const ordered = [...reached]
    .map((missionId) => ({
      missionId,
      startedAt: input.startedAtOf(missionId),
      teammateId: ownerOf.get(missionId) ?? input.missions.get(missionId)?.teammateId
    }))
    // Missions with no start time sort last rather than first: an unknown
    // time is not the beginning of the argument.
    .sort((a, b) => String(a.startedAt ?? '￿').localeCompare(String(b.startedAt ?? '￿')))

  const items: RoomExchangeItem[] = []
  let lastSpeaker: string | undefined
  for (const entry of ordered) {
    const teammateId = entry.teammateId
    if (teammateId === undefined) continue
    const name = input.nameOf(teammateId)
    const text = input.textOf(entry.missionId)
    if (text === undefined || text.trim().length === 0) {
      // Only a FINISHED run that said nothing is a silence. One still going
      // has simply not spoken yet, and drawing it as silent would be a claim
      // about a run that may be about to answer.
      if (!input.finishedOf(entry.missionId)) continue
      items.push({
        kind: 'silent',
        key: `silent_${entry.missionId}`,
        teammateId,
        name,
        missionId: entry.missionId
      })
      lastSpeaker = undefined
      continue
    }
    items.push({
      kind: 'said',
      key: `said_${entry.missionId}`,
      teammateId,
      name,
      text,
      at: entry.startedAt,
      missionId: entry.missionId,
      showTime:
        input.laterPostAt !== undefined
        && entry.startedAt !== undefined
        && entry.startedAt > input.laterPostAt,
      startsSpeaker: lastSpeaker !== teammateId
    })
    lastSpeaker = teammateId
  }

  for (const teammateId of post.waiting ?? []) {
    items.push({
      kind: 'waiting',
      key: `waiting_${teammateId}`,
      teammateId,
      name: input.nameOf(teammateId)
    })
  }

  return {
    items,
    foot: {
      hops: input.hops,
      cap: input.cap,
      cost: input.cost,
      ending: input.hops >= input.cap ? 'out-of-replies' : undefined
    }
  }
}

/** The foot's one line: the budget, the cost, and the ending if there is one. */
export function footLine(foot: RoomExchangeFoot, costText: string | undefined): string {
  const budget = `${String(foot.hops)} of ${String(foot.cap)} automatic ${foot.cap === 1 ? 'reply' : 'replies'}`
  const parts = [budget, ...(costText === undefined ? [] : [costText])]
  const line = parts.join(' · ')
  // Named cause, then where to go -- the same pattern as the Plan-mode note.
  return foot.ending === 'out-of-replies' ? `${line} — post again to continue.` : line
}
