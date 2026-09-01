import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { PublicPeerMessage } from '../../shared/ipc.js'
import { stripShareBlocks } from '../../shared/peer-share.js'

/**
 * Turns the normalized event stream into the thread the workroom renders.
 *
 * This is the layer where "logs never dump into the thread" is actually
 * enforced: raw events go to the Signal Rail, and the thread shows semantic
 * items derived here. Everything is a pure function of the events, so the UI
 * cannot show a step, a count, or a piece of text the provider did not send.
 */

export interface ActivityDetail {
  readonly kind: string
  readonly name: string
  readonly settled: boolean
}

export interface PlanStep {
  readonly text: string
  readonly state: 'done' | 'running' | 'pending'
}

export type ThreadItem =
  | { readonly key: string; readonly type: 'agent-message'; readonly text: string; readonly streaming: boolean }
  | {
      readonly key: string
      readonly type: 'activity'
      readonly summary: string
      readonly details: readonly ActivityDetail[]
    }
  | {
      readonly key: string
      readonly type: 'live-step'
      readonly label: string
      readonly detail: string | undefined
      /** When the step began, so the card can show elapsed time as it runs. */
      readonly startedAt: string
    }
  | {
      readonly key: string
      readonly type: 'plan'
      readonly steps: readonly PlanStep[]
      readonly doneCount: number
    }
  | {
      readonly key: string
      readonly type: 'limit'
      readonly kind: 'quota-exhausted' | 'temporary-rate-limit'
      readonly message: string
    }
  | {
      readonly key: string
      readonly type: 'diagnostic'
      readonly level: 'info' | 'warning' | 'error'
      readonly message: string
    }

/**
 * Read a provider plan into steps. The payload is redacted JSON of whatever
 * shape the provider sent, so every field is checked rather than assumed --
 * an unreadable plan yields no card instead of a malformed one.
 */
export function readPlan(value: unknown): readonly PlanStep[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { plan?: unknown }).plan)
      ? ((value as { plan: unknown[] }).plan)
      : []
  const steps: PlanStep[] = []
  for (const entry of list) {
    if (typeof entry === 'string') {
      steps.push({ text: entry, state: 'pending' })
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const text = record.step ?? record.text ?? record.title ?? record.name
    if (typeof text !== 'string' || text.length === 0) continue
    const status = typeof record.status === 'string' ? record.status.toLowerCase() : ''
    const state: PlanStep['state'] =
      status.includes('complete') || status === 'done'
        ? 'done'
        : status.includes('progress') || status === 'running' || status === 'active'
          ? 'running'
          : 'pending'
    steps.push({ text, state })
  }
  return steps
}

/** Shell verbs that read as file edits rather than as commands. */
const EDIT_COMMANDS = /^(?:apply_patch|patch|edit|write|sed|tee)\b/

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

/**
 * The collapsed activity line. Counts come from tool events only -- never from
 * a guess about what the model said it did.
 */
export function activitySummary(details: readonly ActivityDetail[]): string {
  const edits = details.filter((detail) => detail.kind === 'edit').length
  const commands = details.filter((detail) => detail.kind === 'shell').length
  const other = details.length - edits - commands
  const parts: string[] = []
  if (edits > 0) parts.push(`Edited ${pluralize(edits, 'file')}`)
  if (commands > 0) parts.push(`ran ${pluralize(commands, 'command')}`)
  if (other > 0) parts.push(`${pluralize(other, 'tool call')}`)
  return parts.length === 0 ? 'No tool activity' : parts.join(' · ')
}

function toolKindOf(event: Extract<NormalizedRuntimeEvent, { type: 'tool.started' }>): string {
  const name = event.payload.name
  const command = event.payload.command
  if (name === 'shell' || event.payload.toolKind === 'command_execution') {
    return command !== undefined && EDIT_COMMANDS.test(command.trim()) ? 'edit' : 'shell'
  }
  if (/file|patch|write|edit/i.test(name)) return 'edit'
  return 'tool'
}

/**
 * Rebuild the assistant text the way the transcript did. Deltas carry an
 * `append` or `replace` operation against a per-item buffer, so taking the last
 * delta's text alone returns only its final fragment -- the same trap the
 * checkpoint reconciler documents.
 */
export function assistantMessages(
  events: readonly NormalizedRuntimeEvent[]
): readonly { readonly itemId: string; readonly text: string; readonly final: boolean }[] {
  const order: string[] = []
  const buffers = new Map<string, { text: string; final: boolean }>()
  for (const event of events) {
    if (event.type !== 'message.delta') continue
    const { itemId, operation, text, final } = event.payload
    const existing = buffers.get(itemId)
    if (existing === undefined) order.push(itemId)
    const next = operation === 'replace' ? text : `${existing?.text ?? ''}${text}`
    buffers.set(itemId, { text: next, final })
  }
  return order.map((itemId) => ({ itemId, ...buffers.get(itemId)! }))
}

export interface MissionThreadOptions {
  /** While a run is live the last message shows a streaming caret. */
  readonly running: boolean
}

export function buildThread(
  events: readonly NormalizedRuntimeEvent[],
  options: MissionThreadOptions
): readonly ThreadItem[] {
  const items: ThreadItem[] = []
  const openTools = new Map<string, ActivityDetail>()
  const activity: ActivityDetail[] = []
  let runningStep: { label: string; detail: string | undefined; startedAt: string } | undefined
  let plan: readonly PlanStep[] = []

  for (const event of events) {
    switch (event.type) {
      case 'tool.started': {
        const detail: ActivityDetail = {
          kind: toolKindOf(event),
          name: event.payload.command ?? event.payload.name,
          settled: false
        }
        openTools.set(event.payload.itemId, detail)
        activity.push(detail)
        break
      }
      case 'tool.completed':
      case 'tool.failed': {
        const open = openTools.get(event.payload.itemId)
        if (open !== undefined) {
          const index = activity.indexOf(open)
          if (index >= 0) activity[index] = { ...open, settled: true }
          openTools.delete(event.payload.itemId)
        }
        break
      }
      case 'step.started': {
        const message = event.payload.message
        runningStep = {
          label: message ?? (event.payload.stepKind === 'turn' ? 'Working' : 'Thinking'),
          detail: event.payload.itemType,
          startedAt: event.occurredAt
        }
        break
      }
      case 'plan.updated': {
        plan = readPlan(event.payload.plan)
        break
      }
      case 'step.completed':
      case 'step.failed': {
        runningStep = undefined
        break
      }
      case 'route.limit_detected': {
        items.push({
          key: event.id,
          type: 'limit',
          kind: event.payload.kind,
          message: event.payload.message
        })
        break
      }
      case 'adapter.diagnostic': {
        items.push({
          key: event.id,
          type: 'diagnostic',
          level: event.payload.level,
          message: event.payload.message
        })
        break
      }
      default:
        break
    }
  }

  if (plan.length > 0) {
    items.push({
      key: 'plan',
      type: 'plan',
      steps: plan,
      doneCount: plan.filter((step) => step.state === 'done').length
    })
  }

  if (activity.length > 0) {
    items.push({
      key: 'activity',
      type: 'activity',
      summary: activitySummary(activity),
      details: activity
    })
  }

  for (const message of assistantMessages(events)) {
    // A share block is shown in the peer card, attributed and labelled; left
    // in the bubble it would present the same claim twice, once unlabelled.
    const text = stripShareBlocks(message.text)
    if (text.length === 0) continue
    items.push({
      key: `msg_${message.itemId}`,
      type: 'agent-message',
      text,
      // A caret only where text is genuinely still arriving: the run is live
      // AND the provider has not marked this message final.
      streaming: options.running && !message.final
    })
  }

  if (options.running && runningStep !== undefined) {
    items.push({
      key: 'live-step',
      type: 'live-step',
      label: runningStep.label,
      detail: runningStep.detail,
      startedAt: runningStep.startedAt
    })
  }

  return items
}

/**
 * The cancellation summary, derived from events rather than from file
 * bookkeeping the host does not have. The design's card offers KEPT / STOPPED /
 * NOT DONE; only the middle two are knowable here, so "kept" is deliberately
 * described as what the provider reported finishing, and nothing claims a
 * revert is possible.
 */
export interface CancellationSummary {
  readonly settled: readonly string[]
  readonly interrupted: readonly string[]
  readonly neverStarted: number
}

export function cancellationSummary(
  events: readonly NormalizedRuntimeEvent[],
  plannedSteps = 0
): CancellationSummary {
  const settled: string[] = []
  const open = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool.started') {
      open.set(event.payload.itemId, event.payload.command ?? event.payload.name)
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const name = open.get(event.payload.itemId)
      if (name !== undefined) {
        settled.push(name)
        open.delete(event.payload.itemId)
      }
    }
  }
  const done = settled.length + open.size
  return {
    settled,
    interrupted: [...open.values()],
    neverStarted: Math.max(0, plannedSteps - done)
  }
}

/** Colour class for a Signal Rail row, by what the event means. */
export type SignalTone = 'lime' | 'blue' | 'violet' | 'amber' | 'red' | 'muted'

export interface SignalRow {
  readonly key: string
  readonly name: string
  readonly meta: string
  readonly tone: SignalTone
  readonly live: boolean
}

/**
 * A rail row names what happened; it is not the place for the payload. A real
 * shell invocation can be hundreds of characters (a full PowerShell line, an
 * absolute interpreter path), and pasting it whole turns one row into four and
 * pushes everything else off screen.
 */
export function railLabel(value: string, limit = 72): string {
  const single = value.replace(/\s+/g, ' ').trim()
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`
}

function clockOf(occurredAt: string): string {
  const parsed = new Date(occurredAt)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : ''
}

/**
 * The Signal Rail: raw events, newest first, in the product's own vocabulary.
 *
 * This is where detail belongs -- the thread shows semantic items, the rail
 * shows what actually happened. Tone carries meaning rather than decoration:
 * tools are lime while running and neutral once settled, checkpoints blue,
 * limits amber, failures red.
 */
export function buildSignalRail(
  events: readonly NormalizedRuntimeEvent[],
  options: { readonly running: boolean }
): readonly SignalRow[] {
  const settled = new Set<string>()
  for (const event of events) {
    if (event.type === 'tool.completed' || event.type === 'tool.failed') settled.add(event.payload.itemId)
  }

  const rows: SignalRow[] = []
  for (const event of events) {
    const clock = clockOf(event.occurredAt)
    switch (event.type) {
      case 'run.started':
        rows.push({
          key: event.id,
          name: `runtime.started · ${event.sourceAdapter}`,
          meta: `${clock} · handshake verified`,
          tone: 'muted',
          live: false
        })
        break
      case 'tool.started': {
        const open = !settled.has(event.payload.itemId)
        rows.push({
          key: event.id,
          name: railLabel(`tool.${event.payload.name} · ${event.payload.command ?? event.payload.toolKind}`),
          meta: `${clock} · ${open ? 'running' : 'started'}`,
          tone: open && options.running ? 'lime' : 'muted',
          live: open && options.running
        })
        break
      }
      case 'tool.completed':
        rows.push({
          key: event.id,
          name: `tool.completed · ${event.payload.name}`,
          meta: `${clock}${event.payload.exitCode === undefined ? '' : ` · exit ${event.payload.exitCode}`}`,
          tone: 'muted',
          live: false
        })
        break
      case 'tool.failed':
        rows.push({
          key: event.id,
          name: `tool.failed · ${event.payload.name}`,
          meta: `${clock} · ${event.payload.status ?? 'failed'}`,
          tone: 'red',
          live: false
        })
        break
      case 'step.started':
      case 'step.completed':
      case 'step.failed':
        rows.push({
          key: event.id,
          name: `${event.type} · ${event.payload.stepKind}`,
          meta: clock,
          tone: event.type === 'step.failed' ? 'red' : 'muted',
          live: false
        })
        break
      case 'plan.updated':
        rows.push({
          key: event.id,
          name: `plan.updated${event.payload.final ? ' · final' : ''}`,
          meta: clock,
          tone: 'violet',
          live: false
        })
        break
      case 'route.limit_detected':
        rows.push({
          key: event.id,
          name: `route.limit_detected · ${event.payload.kind}`,
          meta: railLabel(`${clock} · ${event.payload.message}`, 96),
          tone: 'amber',
          live: false
        })
        break
      case 'adapter.diagnostic':
        rows.push({
          key: event.id,
          name: `adapter.diagnostic · ${event.payload.code}`,
          meta: `${clock} · ${event.payload.level}`,
          tone: event.payload.level === 'error' ? 'red' : 'amber',
          live: false
        })
        break
      case 'run.completed':
        rows.push({ key: event.id, name: 'run.completed', meta: `${clock} · receipt written`, tone: 'blue', live: false })
        break
      case 'run.cancelled':
        rows.push({ key: event.id, name: 'run.cancelled', meta: `${clock} · stopped by you`, tone: 'amber', live: false })
        break
      case 'run.failed':
        rows.push({
          key: event.id,
          name: `run.failed · ${event.payload.kind}`,
          meta: railLabel(`${clock} · ${event.payload.message}`, 96),
          tone: 'red',
          live: false
        })
        break
      default:
        break
    }
  }
  // Newest first, as drawn.
  return rows.reverse()
}

export interface PeerGroup {
  /** The OTHER party: `from` of a received message, `to` of a posted one. */
  readonly peer: { readonly teammateId: string; readonly name: string }
  /** Chronological. */
  readonly messages: readonly PublicPeerMessage[]
  /** True when any message in the group was delivered to this mission. */
  readonly received: boolean
}

/**
 * One card per peer. A group that includes a received message sits at the top
 * of the thread, where it was in time -- delivered before the work began; a
 * group of only posted messages sits after the work that produced them.
 */
export function peerGroups(messages: readonly PublicPeerMessage[]): readonly PeerGroup[] {
  const groups = new Map<string, { peer: PeerGroup['peer']; messages: PublicPeerMessage[]; received: boolean }>()
  for (const message of messages) {
    const peer = message.direction === 'received' ? message.from : message.to
    const key = peer.teammateId.length > 0 ? peer.teammateId : `name:${peer.name}`
    const group = groups.get(key) ?? { peer: { teammateId: peer.teammateId, name: peer.name }, messages: [], received: false }
    group.messages.push(message)
    if (message.direction === 'received') group.received = true
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    peer: group.peer,
    messages: [...group.messages].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    received: group.received
  }))
}
