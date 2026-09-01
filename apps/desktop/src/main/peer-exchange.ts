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
  share(input: {
    readonly runId: string
    readonly missionId: string
    readonly peer: MissionPeerContext
    readonly text: string
  }, report: (update: CodexMissionUpdate) => void): Promise<void>
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

export function createPeerExchange(options: {
  readonly workroom: Workroom
  readonly ledger: MissionLedger
}): PeerExchange {
  return {
    async prepare(prompt, peer) {
      try {
        const unread = await options.workroom.unread(peer.self.teammateId, MAX_INBOUND_MESSAGES)
        const composed = composeRuntimePrompt({
          prompt,
          peer,
          inbound: unread.messages,
          remaining: unread.remaining
        })
        return { runtimePrompt: composed.prompt, delivered: composed.delivered, failed: false }
      } catch {
        // The roster trailer still goes: the run can share even when it could
        // not be shown what was waiting.
        const composed = composeRuntimePrompt({ prompt, peer, inbound: [], remaining: 0 })
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
      const blocks = parseShareBlocks(input.text)
      if (blocks.length > MAX_SHARES_PER_MISSION) {
        failed(
          `${peer.self.name} tried to share ${blocks.length} messages; only the first ${MAX_SHARES_PER_MISSION} were sent.`
        )
      }
      for (const block of blocks.slice(0, MAX_SHARES_PER_MISSION)) {
        const target = peer.others.find((entry) => entry.name.toLowerCase() === block.to.toLowerCase())
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
      }
    }
  }
}
