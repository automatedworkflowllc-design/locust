import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { parseDecision } from '../../shared/decision.js'
import { assistantMessages } from './missionView.js'

/**
 * NEEDS YOU (0.373): everything waiting on the person, in one place.
 *
 * A teammate that stops for an approval, or ends its turn by asking a
 * question, waits for the person -- and the person only learned of it by
 * opening that conversation, or from a desktop notification when the window
 * was behind another app. With two teammates working, a question asked in the
 * conversation not on screen sat unanswered while its asker did nothing.
 * Orca gathers every agent that needs attention in one feed, and Vibe Kanban
 * raises a hand on the card (docs/RESEARCH-2026-09-26-ROOMS-AND-PEERS.md):
 * this is Locust's version, one line in the title bar beside what is
 * running, shown only when something waits.
 *
 * In the order a person should answer them: a paused run first -- it is
 * holding a process open -- then a question a teammate stopped on, then
 * memory suggestions, which hold nothing up.
 */

export type NeedsYouItem =
  | {
      readonly kind: 'approval'
      readonly key: string
      readonly missionId: string
      readonly teammateId: string | undefined
      readonly name: string
      /** What it wants to do, or what it asks, in one line. */
      readonly what: string
      /** A question the runtime put, rather than an action it wants to take. */
      readonly asking: boolean
      /** `what` is the exact command it wants to run. */
      readonly command: boolean
    }
  | {
      readonly kind: 'decision'
      readonly key: string
      readonly missionId: string
      readonly teammateId: string | undefined
      readonly name: string
      /** The question, in one line. */
      readonly what: string
    }
  | { readonly kind: 'memory'; readonly key: 'memory'; readonly count: number }

/** A line in the list: long enough to recognise, short enough to be a menu row. */
export const NEEDS_YOU_TEXT = 90

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= NEEDS_YOU_TEXT ? flat : `${flat.slice(0, NEEDS_YOU_TEXT - 1).trimEnd()}…`
}

/**
 * The question a finished turn stopped on, or nothing.
 *
 * The same reading the thread's decision card makes (missionView.ts): the
 * LAST message the runtime marked final, once the run has completed.
 */
export function openQuestion(events: readonly NormalizedRuntimeEvent[]): string | undefined {
  const known = asked.get(events)
  if (known !== undefined) return known === null ? undefined : known
  const last = events.some((event) => event.type === 'run.completed') ? assistantMessages(events).filter((message) => message.final).at(-1) : undefined
  const question = last === undefined ? undefined : parseDecision(last.text)?.question
  asked.set(events, question ?? null)
  return question
}

/**
 * Read once per record. The list is rebuilt whenever a run streams, and a
 * finished turn's events are the same object from one read to the next (the
 * window keeps them by digest), so each is parsed the first time only.
 */
const asked = new WeakMap<readonly NormalizedRuntimeEvent[], string | null>()

export function needsYou(input: {
  /** Runs paused for the person, in the order they arrived. */
  readonly approvals: readonly { readonly approvalId: string; readonly runId: string; readonly missionId: string; readonly kind: string; readonly summary: string; readonly detail: string }[]
  readonly ownerOfRun: (runId: string) => string | undefined
  /**
   * One per conversation, each its newest turn (`collapseConversations`):
   * a question on an older turn was answered by the turn after it.
   */
  readonly conversations: readonly { readonly missionId: string; readonly phase: string }[]
  readonly ownerOfMission: (missionId: string) => string | undefined
  /** The turn's record, when the window holds it. */
  readonly eventsOf: (missionId: string) => readonly NormalizedRuntimeEvent[] | undefined
  readonly nameOf: (teammateId: string) => string | undefined
  /** Memory suggestions waiting on the Memory screen. */
  readonly memoryWaiting: number
}): readonly NeedsYouItem[] {
  const who = (teammateId: string | undefined): string => (teammateId === undefined ? undefined : input.nameOf(teammateId)) ?? 'A teammate'
  const items: NeedsYouItem[] = []
  for (const request of input.approvals) {
    const teammateId = input.ownerOfRun(request.runId)
    /*
     * The command itself, where there is one: "Run a command" names nothing
     * a person can decide on (drive-needs-you, 0.373). A desktop notification
     * never shows it -- a lock screen is no place for a secret -- but this
     * list is inside the app, where the card it opens shows it anyway.
     */
    const command = request.kind === 'command' && request.detail.trim().length > 0
    items.push({
      kind: 'approval',
      key: `approval:${request.approvalId}`,
      missionId: request.missionId,
      teammateId,
      name: who(teammateId),
      what: oneLine(command ? request.detail : request.summary),
      asking: request.kind === 'question',
      command
    })
  }
  for (const conversation of input.conversations) {
    if (conversation.phase !== 'completed') continue
    const events = input.eventsOf(conversation.missionId)
    const question = events === undefined ? undefined : openQuestion(events)
    if (question === undefined) continue
    const teammateId = input.ownerOfMission(conversation.missionId)
    items.push({ kind: 'decision', key: `decision:${conversation.missionId}`, missionId: conversation.missionId, teammateId, name: who(teammateId), what: oneLine(question) })
  }
  if (input.memoryWaiting > 0) items.push({ kind: 'memory', key: 'memory', count: input.memoryWaiting })
  return items
}

/** The item as a row of the menu it opens. */
export function needsYouLabel(item: NeedsYouItem): string {
  if (item.kind === 'memory') return `${String(item.count)} memory suggestion${item.count === 1 ? '' : 's'} waiting`
  if (item.kind === 'decision') return `${item.name} asked: ${item.what}`
  if (item.asking) return `${item.name} is asking: ${item.what}`
  return item.command ? `${item.name} wants to run: ${item.what}` : `${item.name} needs your approval: ${item.what}`
}

/** The chip: how many things wait, as a sentence fragment. */
export function needsYouChip(count: number): string {
  return count === 1 ? '1 needs you' : `${String(count)} need you`
}
