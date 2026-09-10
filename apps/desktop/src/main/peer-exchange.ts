import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { CodexMissionUpdate, PublicPeerMessage } from '../shared/ipc.js'
import { boundedShareText, MAX_SHARES_PER_MISSION, parseShareBlocks } from '../shared/peer-share.js'
import { composeRuntimePrompt, MAX_INBOUND_MESSAGES } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * The two moments a mission touches the workroom, kept apart from the mission
 * transports so every transport does them the same way.
 *
 * BEFORE the run: the teammate's waiting messages are quoted into the prompt
 * and the mission's ledger records which ones, by id. The channel marks them
 * delivered only once the run is actually live, so a start that fails never
 * consumes a message.
 *
 * AFTER a run that completed on its own terms: the final transcript is read
 * for share blocks, each is checked against the roster and bounded, and each
 * becomes one attributed workroom message plus one ledger link. A cancelled
 * or failed run shares nothing -- a half-finished claim is exactly the kind
 * of thing that misleads a colleague.
 */

const MAX_TRACKED_TEXT = 32_000

export interface PreparedPeerPrompt {
  /** What the runtime is sent. */
  readonly runtimePrompt: string
  /** What the prompt quotes, oldest first. */
  readonly delivered: readonly WorkroomMessage[]
  /** True when the channel could not be read; the run proceeds without it. */
  readonly failed: boolean
}

export interface TranscriptTracker {
  track(events: readonly NormalizedRuntimeEvent[]): void
  /** The last assistant message the runtime marked final, rebuilt from deltas. */
  readonly latestFinal: string | undefined
  /** True once a `run.completed` has passed through. */
  readonly completed: boolean
}

export interface PeerExchange {
  prepare(prompt: string, peer: MissionPeerContext): Promise<PreparedPeerPrompt>
  /** Throws when the ledger refuses: a mission must not run on messages it cannot record. */
  recordReceived(missionId: string, delivered: readonly WorkroomMessage[], occurredAt: string): Promise<void>
  /** Never throws: a delivery that cannot be marked is shown again next time, which is the safe direction. */
  markDelivered(missionId: string, delivered: readonly WorkroomMessage[]): Promise<void>
  /** Resolves to the messages actually posted, so a relay can act on them. */
  share(input: {
    readonly runId: string
    readonly missionId: string
    readonly peer: MissionPeerContext
    readonly text: string
  }, report: (update: CodexMissionUpdate) => void): Promise<readonly WorkroomMessage[]>
}

export function publicPeerMessage(message: WorkroomMessage, direction: 'received' | 'posted'): PublicPeerMessage {
  return {
    messageId: message.messageId,
    direction,
    from: { teammateId: message.from.teammateId, name: message.from.name },
    to: { teammateId: message.to.teammateId, name: message.to.name },
    text: message.text,
    at: message.postedAt
  }
}

/**
 * Rebuild assistant text the way the transcript did -- deltas carry an append
 * or replace against a per-item buffer -- keeping the TAIL of an oversized
 * message, because the share form puts its blocks at the end.
 */
export function createTranscriptTracker(): TranscriptTracker {
  const buffers = new Map<string, string>()
  let latestFinal: string | undefined
  let completed = false
  return {
    track(events) {
      for (const event of events) {
        if (event.type === 'message.delta') {
          const { itemId, operation, text, final } = event.payload
          let next = operation === 'replace' ? text : `${buffers.get(itemId) ?? ''}${text}`
          if (next.length > MAX_TRACKED_TEXT) next = next.slice(-MAX_TRACKED_TEXT)
          buffers.set(itemId, next)
          if (final) latestFinal = next
        } else if (event.type === 'run.completed') {
          completed = true
        }
      }
    },
    get latestFinal() {
      return latestFinal
    },
    get completed() {
      return completed
    }
  }
}

/** What the team remembers, worded for a runtime; undefined when memory is off. */
export interface MemoryBriefing {
  section(peer: MissionPeerContext): Promise<string | undefined>
}

/**
 * Who a share block meant, read the way a person would read it.
 *
 * A model writes `to=` from the roster the briefing printed, and the roster
 * prints `Name (Role)`. It has taken the role half twice now, so the role is
 * a way in -- but only when exactly one teammate answers to it. Several
 * teammates can be `Custom`, and a message delivered to whichever of them
 * happened to be first would be worse than one refused out loud.
 *
 * `'self'` is its own answer rather than `undefined`: addressing yourself is
 * not a roster you should go and fix.
 */
export function recipientOf(
  to: string,
  peer: MissionPeerContext
): MissionPeerContext['others'][number] | 'self' | undefined {
  const wanted = to.trim().toLowerCase()
  if (wanted.length === 0) return undefined
  const byName = peer.others.filter((entry) => entry.name.toLowerCase() === wanted)
  if (byName.length === 1) return byName[0]
  if (peer.self.name.toLowerCase() === wanted) return 'self'
  // Ambiguous by name is not resolved by role: two teammates really do share
  // that name, and the app cannot pick one for the person.
  if (byName.length > 1) return undefined
  const byRole = peer.others.filter((entry) => entry.role.toLowerCase() === wanted)
  if (byRole.length === 1) return byRole[0]
  if (byRole.length === 0 && peer.self.role.toLowerCase() === wanted) return 'self'
  return undefined
}

export function createPeerExchange(options: {
  readonly workroom: Workroom
  readonly ledger: MissionLedger
  readonly memory?: MemoryBriefing
}): PeerExchange {
  return {
    async prepare(prompt, peer) {
      // Memory that cannot be read is left out, never a refusal to run.
      const memory = options.memory === undefined ? undefined : await options.memory.section(peer).catch(() => undefined)
      try {
        const unread = await options.workroom.unread(peer.self.teammateId, MAX_INBOUND_MESSAGES)
        const composed = composeRuntimePrompt({
          prompt,
          peer,
          inbound: unread.messages,
          remaining: unread.remaining,
          ...(memory === undefined ? {} : { memory })
        })
        return { runtimePrompt: composed.prompt, delivered: composed.delivered, failed: false }
      } catch {
        // The roster trailer still goes: the run can share even when it could
        // not be shown what was waiting.
        const composed = composeRuntimePrompt({ prompt, peer, inbound: [], remaining: 0, ...(memory === undefined ? {} : { memory }) })
        return { runtimePrompt: composed.prompt, delivered: [], failed: true }
      }
    },

    async recordReceived(missionId, delivered, occurredAt) {
      if (delivered.length === 0) return
      await options.ledger.appendPeerLinks(
        missionId,
        delivered.map((message) => ({
          direction: 'received' as const,
          messageId: message.messageId,
          peerTeammateId: message.from.teammateId,
          occurredAt
        }))
      )
    },

    async markDelivered(missionId, delivered) {
      if (delivered.length === 0) return
      try {
        await options.workroom.markDelivered(delivered.map((message) => message.messageId), missionId)
      } catch {
        // Shown again next time. A repeated claim is recoverable; a lost one is not.
      }
    },

    async share(input, report) {
      const { peer } = input
      const failed = (message: string): void => {
        report({ kind: 'peer-share-failed', runId: input.runId, missionId: input.missionId, message })
      }
      const posted: WorkroomMessage[] = []
      const blocks = parseShareBlocks(input.text)
      if (blocks.length > MAX_SHARES_PER_MISSION) {
        failed(
          `${peer.self.name} tried to share ${blocks.length} messages; only the first ${MAX_SHARES_PER_MISSION} were sent.`
        )
      }
      for (const block of blocks.slice(0, MAX_SHARES_PER_MISSION)) {
        const target = recipientOf(block.to, peer)
        if (target === 'self') {
          /*
           * It addressed ITSELF, and by its own role.
           *
           * The briefing prints the roster as `Jimothy (Finance Bro)`, and
           * on 2026-09-09 Jimothy wrote `to="Finance Bro"` -- his own role
           * label, not another teammate. The old matcher looked at names
           * only, found nothing, and reported "who is not on the roster",
           * which reads as a roster problem the person could go and fix.
           * There was nothing to fix: the message had nowhere to go because
           * it was addressed home.
           *
           * Third variation of one defect. The first two -- single quotes,
           * and the printed `(role)` suffix -- are handled in the parser and
           * documented there. All three are the app failing to read
           * something unambiguous.
           */
          failed(
            `${peer.self.name} addressed a message to "${block.to}", which is ${peer.self.name}'s own ${
              peer.self.name.toLowerCase() === block.to.toLowerCase() ? 'name' : 'role'
            } rather than another teammate. Nothing was sent.`
          )
          continue
        }
        if (target === undefined) {
          // Said out loud: a runtime that addressed someone who is not here
          // was probably working from a stale or invented name, and the
          // person should know that rather than wonder why nothing arrived.
          failed(`${peer.self.name} addressed a message to "${block.to}", who is not on the roster. Nothing was sent.`)
          continue
        }
        const text = boundedShareText(block.text)
        if (text.length === 0) continue
        let message: WorkroomMessage
        try {
          message = await options.workroom.post({
            from: { teammateId: peer.self.teammateId, name: peer.self.name, missionId: input.missionId },
            to: { teammateId: target.teammateId, name: target.name },
            text
          })
        } catch {
          failed(`A message from ${peer.self.name} to ${target.name} could not be written to the workroom. Nothing was sent.`)
          continue
        }
        try {
          await options.ledger.appendPeerLinks(input.missionId, [{
            direction: 'posted',
            messageId: message.messageId,
            peerTeammateId: target.teammateId,
            occurredAt: message.postedAt
          }])
        } catch {
          // The message exists and will reach its recipient; only this
          // mission's own record of having sent it is missing. Both facts
          // are reported: the message below, the gap here.
          failed(`${target.name} will receive ${peer.self.name}'s message, but this mission's ledger could not record that it was sent.`)
        }
        report({
          kind: 'peer-message',
          runId: input.runId,
          missionId: input.missionId,
          message: publicPeerMessage(message, 'posted')
        })
        posted.push(message)
      }
      return posted
    }
  }
}
