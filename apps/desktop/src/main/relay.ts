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
    // MEASURED 2026-09-05, three runs of relay-smoke: the recipient sometimes
    // declined the request as a possible prompt injection and asked for
    // context -- good judgement -- but asked it with a <locust-ask> block,
    // which reaches a PERSON, and a relayed run has none. The question sat in
    // a thread nobody was watching, no share went back, and the exchange
    // ended in silence. The right recipient of that question is the
    // teammate who asked, and the share block is how to reach them.
    noPersonHere(input.sender.name),
    'If nothing more is needed, end with no share block -- that is how an exchange finishes.',
    'Do not start unrelated work.'
  ].join(' ')
}

/**
 * Said in every relayed briefing. A runtime that reaches a fork on a normal
 * mission is told to stop and ask the person; on a relayed run that
 * instruction is still in its prompt, and following it strands the exchange.
 */
function noPersonHere(sender: string): string {
  return (
    `There is no person in this exchange to answer you: ${sender} is a teammate, and the question came from them. `
    + `If you need a decision or more context before you can help, ask ${sender} inside that share block. `
    + 'Do not use a <locust-ask> block here -- it reaches only a person, and nobody is watching this run.'
  )
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

/** A run the relay may care about ending: who it belonged to and what exchange it was in. */
export interface EndedMission {
  readonly missionId: string
  readonly peer: MissionPeerContext | undefined
  readonly relay: RelayOrigin | undefined
}

export interface Relay {
  onShared(mission: SharingMission, posted: readonly WorkroomMessage[]): Promise<void>
  /** Any run ending, however it ended. A meeting counts a recipient who left without answering. */
  onRunEnded(mission: EndedMission): Promise<void>
}

/**
 * A meeting: one teammate wrote to several at once, and their next turn
 * waits until every one of them has answered or given up, then starts ONCE
 * with all the replies quoted -- the minutes -- instead of once per reply,
 * which a teammate who runs one mission at a time could not take anyway.
 */
interface Meeting {
  readonly askerId: string
  readonly askerName: string
  readonly askerRunId: string
  readonly askerMissionId: string
  /** The exchange the reply-back hop belongs to. */
  readonly origin: RelayOrigin
  readonly awaiting: Map<string, string>
  readonly answered: string[]
  /** Those who finished without a word to the asker; named in the minutes. */
  readonly silent: string[]
}

/**
 * The brief for the turn after a meeting. Every reply is quoted by the
 * ordinary inbound section; this only says what the person's teammate is
 * looking at.
 */
export function meetingPrompt(input: { readonly repliers: readonly string[]; readonly silent: readonly string[] }): string {
  const who = input.repliers.length === 1 ? input.repliers[0] : `${input.repliers.slice(0, -1).join(', ')} and ${input.repliers[input.repliers.length - 1]}`
  return [
    `${who} replied to your message; the replies are quoted below.`,
    ...(input.silent.length === 0 ? [] : [`${input.silent.join(', ')} finished without replying.`]),
    'Take them together. Write back to anyone only if that helps finish the work: one <locust-share to="Name"> block per teammate.',
    'There is no person in this exchange to answer you; a question for any of them goes in their share block, never in a <locust-ask> block, which reaches only a person.',
    'If nothing more is needed, end with no share block -- that is how an exchange finishes.',
    'Do not start unrelated work.'
  ].join(' ')
}

export function createRelay(options: RelayOptions): Relay {
  /** Open meetings by the asker's mission id. */
  const meetings = new Map<string, Meeting>()
  /**
   * One-to-one exchanges the host started and is still waiting on, keyed by
   * the RECIPIENT's mission. A meeting keeps minutes and says who stayed
   * silent; an ordinary exchange kept nothing, so when a recipient answered
   * in prose instead of a reply block the asker's thread simply showed
   * nothing at all -- Colin, 2026-09-05: "wren answered it but only in his
   * own chat, we never got the reply in booty's chat".
   */
  const exchanges = new Map<
    string,
    { readonly askerRunId: string; readonly askerMissionId: string; readonly askerId: string; readonly recipientName: string }
  >()
  /** Which meeting a relayed run is answering, by that run's mission id. */
  const answering = new Map<string, Meeting>()

  const notify = (runId: string, missionId: string, message: string): void => {
    options.notify({ kind: 'relay-notice', runId, missionId, message })
  }

  const startFor = async (input: {
    readonly recipient: MissionPeerContext
    readonly prompt: string
    readonly from: SharingMission
    readonly origin: RelayOrigin
    readonly notice: (message: string) => void
  }): Promise<{ readonly missionId: string } | undefined> => {
    const { recipient, from } = input
    const followUpOf = input.origin.lastMissionOf[recipient.self.teammateId]
    // Their own route, so each teammate stays the model a person made
    // them. Only a teammate who has never run borrows the sender's.
    const own = recipient.self.route
    const route = own ?? {
      runtime: from.runtime,
      model: from.model ?? 'account-default',
      mode: from.sandbox === 'workspace-write' ? ('accept-edits' as const) : ('ask' as const)
    }
    if (own === undefined) {
      input.notice(
        `${recipient.self.name} has not run on a route of their own yet, so this reply runs on ${from.peer.self.name}'s ${runtimeDisplayName(route.runtime)} / ${route.model}. Message ${recipient.self.name} once on the route they should keep.`
      )
    }
    let response: CodexMissionStartResponse
    try {
      response = await options.start({
        prompt: input.prompt,
        runtime: route.runtime,
        mode: route.mode,
        model: route.model === 'account-default' ? undefined : route.model,
        peer: recipient,
        followUpOf,
        relay: input.origin
      })
    } catch {
      input.notice(`${recipient.self.name} could not reply on their own: the run could not be started.`)
      return undefined
    }
    if (!response.ok) {
      input.notice(`${recipient.self.name} could not reply on their own: ${response.error.message} The message waits for their next run.`)
      return undefined
    }
    await options.assignOwner(recipient.self.teammateId, response.data.missionId).catch(() => undefined)
    options.notify({
      kind: 'mission-started',
      runId: response.data.runId,
      missionId: response.data.missionId,
      teammateId: recipient.self.teammateId,
      prompt: input.prompt,
      data: response.data,
      startedBy: { kind: 'relay', hop: input.origin.hop }
    })
    return { missionId: response.data.missionId }
  }

  /** The asker's next turn, once, briefed with everyone's reply. */
  const closeMeeting = async (meeting: Meeting, from: SharingMission): Promise<void> => {
    meetings.delete(meeting.askerMissionId)
    const asker = await options.peerContextFor(meeting.askerId)
    if (asker === undefined) return
    if (meeting.answered.length === 0) {
      notify(meeting.askerRunId, meeting.askerMissionId, 'Nobody replied. Your message waits with them for their next run.')
      return
    }
    const silent = [...meeting.silent, ...meeting.awaiting.values()]
    const origin: RelayOrigin = {
      hop: meeting.origin.hop + 1,
      lastMissionOf: { ...meeting.origin.lastMissionOf, [from.peer.self.teammateId]: from.missionId }
    }
    if (origin.hop > MAX_RELAY_HOPS) {
      notify(meeting.askerRunId, meeting.askerMissionId, `Stopped after ${String(MAX_RELAY_HOPS)} automatic replies. The replies wait for your next run.`)
      return
    }
    await startFor({
      recipient: asker,
      prompt: meetingPrompt({ repliers: meeting.answered, silent }),
      from,
      origin,
      notice: (message) => notify(meeting.askerRunId, meeting.askerMissionId, message)
    })
  }

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
      const notice = (message: string): void => notify(mission.runId, mission.missionId, message)

      // A reply into an open meeting is held, not relayed: the asker's turn
      // starts once everyone has spoken. The message itself is already in
      // the workroom, so nothing is lost by waiting.
      const meeting = answering.get(mission.missionId)
      const held = new Set<string>()
      if (meeting !== undefined && meeting.awaiting.has(mission.peer.self.teammateId)) {
        if (posted.some((message) => message.to.teammateId === meeting.askerId)) {
          meeting.awaiting.delete(mission.peer.self.teammateId)
          meeting.answered.push(mission.peer.self.name)
          held.add(meeting.askerId)
          if (meeting.awaiting.size > 0) {
            notify(
              meeting.askerRunId,
              meeting.askerMissionId,
              `${mission.peer.self.name} replied. Still waiting on ${[...meeting.awaiting.values()].join(', ')}.`
            )
          } else {
            await closeMeeting(meeting, mission)
          }
        }
      }

      // One automatic run per recipient per share, whatever was posted: a
      // run that wrote to the same teammate twice gets one reply, not two.
      // This run answering an exchange it was started for: whatever else it
      // does, the asker is no longer waiting in silence.
      const waiting = exchanges.get(mission.missionId)
      if (waiting !== undefined && posted.some((message) => message.to.teammateId === waiting.askerId)) {
        exchanges.delete(mission.missionId)
      }

      const seen = new Set<string>()
      const started: { readonly teammateId: string; readonly name: string; readonly missionId: string }[] = []
      for (const message of posted) {
        const recipientId = message.to.teammateId
        if (seen.has(recipientId) || held.has(recipientId)) continue
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
        const result = await startFor({
          recipient,
          prompt: relayPrompt({ sender: mission.peer.self, recipient: recipient.self, hop: origin.hop }),
          from: mission,
          origin,
          notice
        })
        if (result !== undefined) started.push({ teammateId: recipientId, name: recipient.self.name, missionId: result.missionId })
      }

      // Writing to several teammates at once opens a meeting: their answers
      // are collected, and the asker's next turn starts once, with all of
      // them. One recipient is an ordinary exchange and needs no minutes.
      if (started.length >= 2) {
        const opened: Meeting = {
          askerId: mission.peer.self.teammateId,
          askerName: mission.peer.self.name,
          askerRunId: mission.runId,
          askerMissionId: mission.missionId,
          origin: { hop, lastMissionOf: { ...(mission.relay?.lastMissionOf ?? {}), [mission.peer.self.teammateId]: mission.missionId } },
          awaiting: new Map(started.map((entry) => [entry.teammateId, entry.name])),
          answered: [],
          silent: []
        }
        meetings.set(mission.missionId, opened)
        for (const entry of started) answering.set(entry.missionId, opened)
        notice(`Waiting on ${started.map((entry) => entry.name).join(', ')} to reply before your next turn.`)
      } else {
        for (const entry of started) {
          exchanges.set(entry.missionId, {
            askerRunId: mission.runId,
            askerMissionId: mission.missionId,
            askerId: mission.peer.self.teammateId,
            recipientName: entry.name
          })
        }
      }
    },

    async onRunEnded(mission) {
      // An ordinary exchange that ended with nothing written back. The reply
      // is not lost -- it is in the recipient's own conversation -- and the
      // person watching the thread that asked is told where to find it,
      // rather than being left to conclude the message never arrived.
      const exchange = exchanges.get(mission.missionId)
      exchanges.delete(mission.missionId)
      if (exchange !== undefined) {
        notify(
          exchange.askerRunId,
          exchange.askerMissionId,
          `${exchange.recipientName} finished without writing back. Anything they said is in their own conversation.`
        )
      }
      const meeting = answering.get(mission.missionId)
      answering.delete(mission.missionId)
      if (meeting === undefined || mission.peer === undefined) return
      const teammateId = mission.peer.self.teammateId
      if (!meeting.awaiting.has(teammateId)) return
      // Ended without a word to the asker: counted, not waited for forever.
      meeting.awaiting.delete(teammateId)
      meeting.silent.push(mission.peer.self.name)
      if (meeting.awaiting.size > 0) {
        notify(
          meeting.askerRunId,
          meeting.askerMissionId,
          `${mission.peer.self.name} finished without replying. Still waiting on ${[...meeting.awaiting.values()].join(', ')}.`
        )
        return
      }
      await closeMeeting(meeting, {
          runId: '',
          missionId: mission.missionId,
          runtime: 'codex',
          sandbox: 'read-only',
          model: undefined,
          peer: mission.peer,
          relay: mission.relay
        })
    }
  }
}
