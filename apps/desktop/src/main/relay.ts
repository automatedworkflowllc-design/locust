import type { WorkroomMessage } from '@teammate/mission-store'
import type { MissionRuntimeId, MissionSandbox } from '@teammate/runtime-adapters'

import type { CodexMissionStartResponse, CodexMissionUpdate, MissionMode } from '../shared/ipc.js'
import type { MissionPeerContext, PeerRosterEntry } from './workroom-briefing.js'
import { runtimeDisplayName } from '../shared/runtimes.js'

/**
 * Teammates replying to each other without a person in the loop.
 *
 * Before this, a message from Wren to Booty waited in the workroom until
 * someone next messaged Booty, and Booty's answer waited until someone next
 * messaged Wren. Delivered, attributed, and not a conversation. The relay
 * closes that loop: when a run posts a share, the host may start a run for
 * the recipient with that share as its brief, and when THAT run posts back,
 * start the original sender's next turn so the answer lands in the thread
 * that asked.
 *
 * Three limits, each load-bearing:
 *
 *   - A switch in Settings, on by default. Talking to each other is the
 *     point of having more than one teammate; the cap is what bounds it.
 *   - The exchange ends when a reply carries no message: each hop is asked
 *     to write back only if that helps finish the work, and a run that
 *     posts no share starts nothing. The hop cap is a backstop for two
 *     agents thanking each other until the account is empty, not the
 *     length of a conversation.
 *   - The recipient's run uses the RECIPIENT's own runtime, model and mode,
 *     the route a person last started them on. Grok answers as Grok, Fable
 *     as Fable; a teammate who has never run yet borrows the sender's route,
 *     and the thread says so. A route that cannot start is refused, not
 *     widened.
 *
 * Nothing about the record changes. A relayed run is an ordinary mission,
 * owned by the recipient, whose prompt is the host's brief; the messages it
 * was shown are recorded by id exactly as they are for a person's mission.
 */

/**
 * Automatic runs per exchange before the host stops and waits for a person.
 * A backstop, not a target: an exchange normally ends when a reply has
 * nothing more to say. Three round trips is generous for finishing a job.
 */
export const MAX_RELAY_HOPS = 6

export interface RelayOrigin {
  /** How many automatic runs preceded this one in the exchange. 0 for a person's mission. */
  readonly hop: number
  /**
   * Each participant's latest mission in this exchange, so their next hop
   * continues THEIR conversation rather than starting a stranger. The
   * person-started mission is the first entry.
   */
  readonly lastMissionOf: Readonly<Record<string, string>>
}

export type RelayDecision =
  | { readonly start: true; readonly hop: number }
  | { readonly start: false; readonly reason: string }

/**
 * Whether a posted message earns an automatic run for its recipient. Pure,
 * so the cap and the default can be proven without a runtime.
 */
export function decideRelay(input: {
  readonly enabled: boolean
  readonly hop: number
  readonly recipientName: string
}): RelayDecision {
  if (!input.enabled) {
    return { start: false, reason: 'Teammate replies are switched off in Settings; the message waits for their next run.' }
  }
  if (input.hop >= MAX_RELAY_HOPS) {
    return {
      start: false,
      reason: `Stopped after ${String(MAX_RELAY_HOPS)} automatic replies. ${input.recipientName} will see this on their next run.`
    }
  }
  return { start: true, hop: input.hop + 1 }
}

/**
 * The brief a relayed run is started with. It is recorded as that mission's
 * prompt, so it says plainly who asked and what is expected; the message
 * itself is quoted by the ordinary inbound section, marked as a claim like
 * every other teammate message.
 */
export function relayPrompt(input: {
  readonly sender: PeerRosterEntry
  readonly recipient: PeerRosterEntry
  readonly hop: number
}): string {
  const who = `${input.sender.name} (${input.sender.role})`
  const opening = input.hop <= 1
    ? `${who} sent you a message; it is quoted below with anything else waiting for you.`
    : `${who} replied to you; it is quoted below.`
  return [
    opening,
    'Do what it asks if that is within your role and this workspace, using what you actually know; if you cannot help, say so briefly.',
    `Write back only if that helps finish the work: end with one <locust-share to="${input.sender.name}"> block holding your reply.`,
    'If nothing more is needed, end with no share block -- that is how an exchange finishes.',
    'Do not start unrelated work.'
  ].join(' ')
}

/** What a mission that just shared looks like to the relay. */
export interface SharingMission {
  readonly runId: string
  readonly missionId: string
  readonly runtime: MissionRuntimeId
  readonly sandbox: MissionSandbox
  readonly model: string | undefined
  readonly peer: MissionPeerContext
  readonly relay: RelayOrigin | undefined
}

export interface RelayOptions {
  readonly enabled: () => Promise<boolean>
  readonly peerContextFor: (teammateId: string) => Promise<MissionPeerContext | undefined>
  readonly start: (input: {
    readonly prompt: string
    readonly runtime: MissionRuntimeId
    readonly mode: MissionMode
    readonly model: string | undefined
    readonly peer: MissionPeerContext
    readonly followUpOf: string | undefined
    readonly relay: RelayOrigin
  }) => Promise<CodexMissionStartResponse>
  readonly assignOwner: (teammateId: string, missionId: string) => Promise<void>
  /** Reaches the window, addressed to the SENDER's run, so notices land in the thread that shared. */
  readonly notify: (update: CodexMissionUpdate) => void
}

export interface Relay {
  onShared(mission: SharingMission, posted: readonly WorkroomMessage[]): Promise<void>
}

export function createRelay(options: RelayOptions): Relay {
  return {
    async onShared(mission, posted) {
      if (posted.length === 0) return
      let enabled = false
      try {
        enabled = await options.enabled()
      } catch {
        enabled = false
      }
      const hop = mission.relay?.hop ?? 0
      const notice = (message: string): void => {
        options.notify({ kind: 'relay-notice', runId: mission.runId, missionId: mission.missionId, message })
      }
      // One automatic run per recipient per share, whatever was posted: a
      // run that wrote to the same teammate twice gets one reply, not two.
      const seen = new Set<string>()
      for (const message of posted) {
        const recipientId = message.to.teammateId
        if (seen.has(recipientId)) continue
        seen.add(recipientId)

        const decision = decideRelay({ enabled, hop, recipientName: message.to.name })
        if (!decision.start) {
          // Off is the default and needs no announcement; a cap that fired
          // does, because the person is watching an exchange stop.
          if (enabled) notice(decision.reason)
          continue
        }

        const recipient = await options.peerContextFor(recipientId)
        if (recipient === undefined) {
          notice(`${message.to.name} is no longer on the roster; nothing was started.`)
          continue
        }
        const origin: RelayOrigin = {
          hop: decision.hop,
          lastMissionOf: { ...(mission.relay?.lastMissionOf ?? {}), [mission.peer.self.teammateId]: mission.missionId }
        }
        // Each hop is the next turn of ITS teammate's conversation in this
        // exchange, so both sides read as one thread. A recipient who has
        // not spoken in it yet starts fresh: they were not in a conversation
        // about this.
        const followUpOf = origin.lastMissionOf[recipientId]
        const prompt = relayPrompt({ sender: mission.peer.self, recipient: recipient.self, hop: origin.hop })
        // Their own route, so each teammate stays the model a person made
        // them. Only a teammate who has never run borrows the sender's.
        const own = recipient.self.route
        const route = own ?? {
          runtime: mission.runtime,
          model: mission.model ?? 'account-default',
          mode: mission.sandbox === 'workspace-write' ? ('accept-edits' as const) : ('ask' as const)
        }
        if (own === undefined) {
          notice(
            `${recipient.self.name} has not run on a route of their own yet, so this reply runs on ${mission.peer.self.name}'s ${runtimeDisplayName(route.runtime)} / ${route.model}. Message ${recipient.self.name} once on the route they should keep.`
          )
        }
        let response: CodexMissionStartResponse
        try {
          response = await options.start({
            prompt,
            runtime: route.runtime,
            mode: route.mode,
            model: route.model === 'account-default' ? undefined : route.model,
            peer: recipient,
            followUpOf,
            relay: origin
          })
        } catch {
          notice(`${recipient.self.name} could not reply on their own: the run could not be started.`)
          continue
        }
        if (!response.ok) {
          notice(`${recipient.self.name} could not reply on their own: ${response.error.message} The message waits for their next run.`)
          continue
        }
        await options.assignOwner(recipient.self.teammateId, response.data.missionId).catch(() => undefined)
        options.notify({
          kind: 'mission-started',
          runId: response.data.runId,
          missionId: response.data.missionId,
          teammateId: recipient.self.teammateId,
          prompt,
          data: response.data,
          hop: origin.hop
        })
      }
    }
  }
}
