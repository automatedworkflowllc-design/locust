import type { NormalizedRuntimeEvent, ToolPatch } from '@teammate/runtime-adapters'

import { LARGE_FILE_LINES, fileCounts, parseUnifiedDiff } from './diff.js'
import type { DiffCounts, DiffFile } from './diff.js'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'

import type { PublicPeerMessage, PublicRecoveredMission } from '../../shared/ipc.js'
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
  /**
   * What the runtime called the tool. `name` is often the target -- a path,
   * a command -- so without this a read of a file it also edited renders as
   * the same path twice with nothing to tell them apart.
   */
  readonly tool?: string
  readonly settled: boolean
  /** True only for a tool the runtime itself reported as failed. */
  readonly failed?: boolean
  readonly exitCode?: number
  /** The change the tool made, when the runtime reported one. */
  readonly patch?: ToolPatch
}

/**
 * An activity row, ready to draw. Files carry their parsed diff; shell rows
 * carry their result; an edit whose runtime reported no patch stays in the
 * list as an `unreported` row rather than vanishing, because a missing row
 * would understate what the teammate did.
 */
export type ActivityEntry =
  | {
      readonly kind: 'file'
      readonly key: string
      readonly file: DiffFile
      readonly counts: DiffCounts
      readonly truncated: boolean
      /** The runtime's own total, when the recorded text was cut short. */
      readonly reported: DiffCounts | undefined
      readonly large: boolean
    }
  | {
      readonly kind: 'shell'
      readonly key: string
      readonly command: string
      readonly settled: boolean
      readonly failed: boolean
      readonly exitCode: number | undefined
    }
  | {
      readonly kind: 'unreported' | 'tool'
      readonly key: string
      readonly name: string
      /** The runtime's own word for what it did: `read`, `search`, `list`. */
      readonly tool: string | undefined
      readonly settled: boolean
      readonly failed: boolean
    }

/**
 * Expand each activity detail into the rows the card draws. One patch can
 * touch several files, and each becomes its own row -- the same rows the
 * counts are summed from, so the card's total and the diffs beneath it are
 * two views of one array and cannot disagree.
 */
export function activityEntries(details: readonly ActivityDetail[]): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = []
  details.forEach((detail, index) => {
    const failed = detail.failed === true
    if (detail.kind === 'shell') {
      entries.push({
        kind: 'shell',
        key: `shell_${String(index)}`,
        command: detail.name,
        settled: detail.settled,
        failed,
        exitCode: detail.exitCode
      })
      return
    }
    const patch = detail.patch
    const files = patch === undefined ? [] : parseUnifiedDiff(patch.text)
    if (files.length === 0) {
      // An edit whose runtime named its files but sent no diff (Codex's
      // file_change) is one row PER FILE, each saying the change was not
      // reported -- never one row named after the tool with no path at all.
      const named = detail.kind === 'edit' && detail.tool === detail.name && detail.name.includes('\n')
        ? detail.name.split('\n').filter((path) => path.length > 0)
        : undefined
      if (named !== undefined && named.length > 0) {
        named.forEach((path, fileIndex) => {
          entries.push({
            kind: 'unreported',
            key: `item_${String(index)}_${String(fileIndex)}`,
            name: path,
            tool: undefined,
            settled: detail.settled,
            failed
          })
        })
        return
      }
      entries.push({
        kind: detail.kind === 'edit' ? 'unreported' : 'tool',
        key: `item_${String(index)}`,
        name: detail.name,
        tool: detail.tool === detail.name ? undefined : detail.tool,
        settled: detail.settled,
        failed
      })
      return
    }
    files.forEach((file, fileIndex) => {
      const counts = fileCounts(file)
      entries.push({
        kind: 'file',
        key: `file_${String(index)}_${String(fileIndex)}`,
        file,
        counts,
        truncated: patch?.truncated === true,
        // A single-file patch can be checked against the runtime's own total;
        // across several files the total belongs to none of them, so it is
        // withheld rather than repeated on each row as if it were theirs.
        reported:
          patch !== undefined && patch.truncated && files.length === 1
            ? { added: patch.added, removed: patch.removed }
            : undefined,
        large: counts.added + counts.removed > LARGE_FILE_LINES
      })
    })
  })
  return entries
}

/**
 * The card's `+N -M`. Summed from the rendered rows, never from a runtime's
 * header: if a patch was cut short, the header would promise lines the diff
 * below cannot show.
 */
export function activityCounts(details: readonly ActivityDetail[]): DiffCounts {
  let added = 0
  let removed = 0
  for (const entry of activityEntries(details)) {
    if (entry.kind !== 'file') continue
    added += entry.counts.added
    removed += entry.counts.removed
  }
  return { added, removed }
}

/**
 * Which file opens by default: the first one, unless it is large enough that
 * opening it would bury everything after it.
 */
export function defaultOpenEntry(entries: readonly ActivityEntry[]): string | undefined {
  const first = entries.find((entry) => entry.kind === 'file')
  if (first === undefined || first.kind !== 'file') return undefined
  return first.large ? undefined : first.key
}

/** `14:44`, in the host's own timezone. */
export function clockTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '--:--'
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** Whole minutes between two instants, floored, never negative. */
export function minutesBetween(from: string, to: string): number {
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.floor((end - start) / 60_000))
}

/**
 * A quiet gap worth marking. Below this a marker is noise; above it, the
 * reader deserves to know the mission sat still.
 */
export const QUIET_GAP_MINUTES = 2

export interface ThreadMarker {
  /** Index of the turn this marker sits ABOVE. */
  readonly beforeTurn: number
  readonly at: string
  readonly minutesIn: number
  /** Said only when the gap is the point, e.g. `waited 6 min`. */
  readonly note: string | undefined
}

/**
 * Where a long conversation earns a time marker. A turn that follows the one
 * before it within a couple of minutes needs no marker -- it reads as the
 * same stretch of work. A gap longer than that is a fact about the mission
 * (you were away, or it was waiting on you), and stating it beats leaving
 * the reader to subtract two timestamps that are not on screen.
 */
export function threadMarkers(turns: readonly (readonly NormalizedRuntimeEvent[])[]): readonly ThreadMarker[] {
  const origin = turns.flat()[0]?.occurredAt
  if (origin === undefined) return []
  const markers: ThreadMarker[] = []
  for (let index = 1; index < turns.length; index += 1) {
    const previous = turns[index - 1]?.at(-1)?.occurredAt
    const next = turns[index]?.[0]?.occurredAt
    if (previous === undefined || next === undefined) continue
    const gap = minutesBetween(previous, next)
    if (gap < QUIET_GAP_MINUTES) continue
    markers.push({
      beforeTurn: index,
      at: next,
      minutesIn: minutesBetween(origin, next),
      note: `waited ${String(gap)} min`
    })
  }
  return markers
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
      /**
       * Which runtime reported this work, so a row with no recorded change
       * can name it. Read off the events, never assumed.
       */
      readonly reportedBy: MissionRuntimeId | undefined
    }
  | {
      readonly key: string
      readonly type: 'live-step'
      readonly label: string
      readonly detail: string | undefined
      /** When the step began, so the card can show elapsed time as it runs. */
      readonly startedAt: string
      /**
       * What kind of step: a tool or turn is the teammate DOING something and
       * their face works; reasoning is thought, shown as a still face with
       * staggered dots. Never a bar or a synthetic percentage.
       */
      readonly kind: 'turn' | 'reasoning' | 'item'
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
  // Files, not edit calls: one Codex file_change can touch several files, and
  // "Edited 1 file" over a two-file change is the wrong number.
  const edits = details
    .filter((detail) => detail.kind === 'edit')
    .reduce((sum, detail) => sum + Math.max(1, detail.name.split('\n').filter((line) => line.length > 0).length), 0)
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
  let runningStep:
    | { label: string; detail: string | undefined; startedAt: string; kind: 'turn' | 'reasoning' | 'item' }
    | undefined
  let plan: readonly PlanStep[] = []
  // Notices that arrive before the run has done anything are the runtime
  // talking about its own setup (a skills budget, a config warning), not
  // about the mission. They stay in the Signal Rail; the thread keeps only
  // notices raised while the work was under way.
  let workBegan = false

  for (const event of events) {
    switch (event.type) {
      case 'tool.started': {
        workBegan = true
        const detail: ActivityDetail = {
          kind: toolKindOf(event),
          name: event.payload.command ?? event.payload.name,
          tool: event.payload.name,
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
          const patch = event.payload.patch
          if (index >= 0) {
            activity[index] = {
              ...open,
              settled: true,
              failed: event.type === 'tool.failed',
              ...(event.payload.exitCode === undefined ? {} : { exitCode: event.payload.exitCode }),
              // A completion that carries a patch also names what it touched:
              // the row's kind follows the evidence, not the tool's name.
              ...(patch === undefined ? {} : { patch, kind: 'edit' })
            }
          }
          openTools.delete(event.payload.itemId)
        }
        break
      }
      case 'step.started': {
        // A turn opening is not work yet: Codex raises its setup notices
        // right after it, before any tool runs, and counting the turn as work
        // put "skill descriptions were shortened" back in every thread.
        if (event.payload.stepKind !== 'turn') workBegan = true
        const message = event.payload.message
        runningStep = {
          label: message ?? (event.payload.stepKind === 'turn' ? 'Working' : 'Thinking'),
          detail: event.payload.itemType,
          startedAt: event.occurredAt,
          kind: event.payload.stepKind
        }
        break
      }
      case 'plan.updated': {
        workBegan = true
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
        if (!workBegan) break
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
      details: activity,
      reportedBy: events.find((event) => event.type.startsWith('tool.'))?.sourceAdapter
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
      startedAt: runningStep.startedAt,
      kind: runningStep.kind
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

/**
 * The mission a continuation chain started from. A handed-off mission's own
 * recorded prompt is the briefing the host wrote, so the words a person
 * actually typed live on the FIRST mission of the chain. Bounded walk: a
 * cycle in hand-edited ledgers must not spin forever.
 */
export function rootMission(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): PublicRecoveredMission {
  let current = mission
  for (let hops = 0; hops < 32; hops += 1) {
    const priorId = current.continuesFrom?.missionId
    if (priorId === undefined) return current
    const prior = byId.get(priorId)
    if (prior === undefined) return current
    current = prior
  }
  return current
}

export interface StitchedHandoff {
  readonly from: PublicRecoveredMission['runtime']
  readonly to: PublicRecoveredMission['runtime']
  readonly at: string | undefined
  readonly unsettledCount: number
  readonly omittedBriefing: readonly string[]
  readonly priorEvents: readonly NormalizedRuntimeEvent[]
}

/**
 * The divider for a recovered continuation, rebuilt from the durable record.
 * The unsettled count is the prior mission's route-switch checkpoint -- the
 * same number the live divider showed -- and not a recount, so a reopened
 * thread says what it said at the time. What the briefing omitted was never
 * recorded, so it is reported as nothing rather than guessed.
 */
export function stitchedHandoff(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): StitchedHandoff | undefined {
  const link = mission.continuesFrom
  // A follow-up continues the same runtime's own conversation: there is no
  // seam to draw, and a "Codex to Codex" divider across an ordinary reply
  // would invent an event that never happened.
  if (link === undefined || link.reason !== 'route-switch') return undefined
  const prior = byId.get(link.missionId)
  if (prior === undefined) return undefined
  const checkpoint = prior.checkpoints.find((entry) => entry.epoch === link.checkpointEpoch)
  return {
    from: prior.runtime,
    to: mission.runtime,
    at: new Date(mission.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    unsettledCount: checkpoint?.unsettledActions.length ?? 0,
    omittedBriefing: [],
    priorEvents: prior.events
  }
}

/**
 * What a route's model actually turned out to be, learned from missions that
 * already ran.
 *
 * Claude Code takes an ALIAS -- `fable`, `opus`, `sonnet` -- and resolves it
 * to whichever model is newest in that family, so the shell cannot know the
 * real name up front without asking, and asking costs a turn. It does not
 * have to: the runtime states the resolved model in its own start record, so
 * every finished mission on that alias is a free, current answer. Keyed
 * `runtime:model`, newest mission wins.
 *
 * This is earned knowledge, never a guess: an alias nobody has run yet simply
 * has no entry, and the picker says what it does know instead of inventing a
 * version number that would rot.
 */
export function resolvedModelNames(
  missions: readonly PublicRecoveredMission[]
): ReadonlyMap<string, string> {
  const byRoute = new Map<string, { readonly at: number; readonly name: string }>()
  for (const mission of missions) {
    const started = mission.events.find((event) => event.type === 'run.started')
    if (started === undefined || started.type !== 'run.started') continue
    const raw = started.payload.evidence.raw
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const name = (raw as Record<string, unknown>).model
    // Only a real, different name is worth showing: `fable -> fable` teaches
    // nothing, and a blank teaches less.
    if (typeof name !== 'string' || name.length === 0 || name === mission.model) continue
    const key = `${mission.runtime}:${mission.model}`
    const at = Date.parse(mission.createdAt)
    const held = byRoute.get(key)
    if (held === undefined || (Number.isFinite(at) && at > held.at)) {
      byRoute.set(key, { at: Number.isFinite(at) ? at : 0, name })
    }
  }
  return new Map([...byRoute].map(([key, held]) => [key, held.name]))
}

export function resolvedModelKey(runtime: MissionRuntimeId, model: string): string {
  return `${runtime}:${model}`
}

export interface ConversationTurn {
  readonly missionId: string
  /** What the person typed for this turn. */
  readonly prompt: string
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly peerMessages: PublicRecoveredMission['peerMessages']
}

/**
 * A mission and every earlier turn of its conversation, oldest first.
 *
 * Each turn is its own mission -- one mission holds one run, and a second turn
 * is a second process -- so the thread has to walk the `follow-up` links back
 * to rebuild what a person experienced as one exchange. Only follow-ups are
 * walked: a route switch is a different kind of continuation and keeps its
 * divider. Bounded, so a hand-edited cycle cannot spin.
 */
export function conversationTurns(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): readonly ConversationTurn[] {
  const chain: PublicRecoveredMission[] = [mission]
  let current = mission
  for (let hops = 0; hops < 64; hops += 1) {
    const link = current.continuesFrom
    if (link === undefined || link.reason !== 'follow-up') break
    const prior = byId.get(link.missionId)
    if (prior === undefined || chain.some((held) => held.missionId === prior.missionId)) break
    chain.push(prior)
    current = prior
  }
  return chain
    .reverse()
    .map((turn) => ({
      missionId: turn.missionId,
      prompt: turn.prompt,
      events: turn.events,
      peerMessages: turn.peerMessages
    }))
}

/**
 * The runtime session a reply could resume, if the run left one.
 *
 * A mission that ended is not automatically a conversation you can continue.
 * When a run fails BEFORE its runtime ever started -- the CLI was not ready,
 * the process could not launch -- no session was ever opened, and the host
 * has nothing to resume. Treating the next message as a reply there turns an
 * ordinary sentence into an error card, and the person's message is not sent
 * at all. A fresh mission is what they meant, and what they get.
 *
 * The session id is read from the events the run actually produced, so this
 * cannot claim one that was never recorded.
 */
/**
 * Capacity exhaustion, in whatever words a runtime uses for it. Cursor says
 * `RetriableError: [resource_exhausted]`, which names a real condition in
 * language nobody outside its codebase can read.
 */
const EXHAUSTION_PATTERNS = [
  /\bresource_exhausted\b/i,
  /\binsufficient_quota\b/i,
  /\bquota (?:exceeded|exhausted)\b/i,
  /\brate[_ -]?limit(?:ed| exceeded)?\b/i,
  /\btoo many requests\b/i,
  /\bhttp\s*429\b/i
] as const

/** The last line of stderr that says something, or undefined. */
function lastStderrLine(stderr: string | undefined): string | undefined {
  if (stderr === undefined) return undefined
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  return lines.at(-1)
}

/**
 * What to put on a failure card.
 *
 * The host's own sentence names the SHAPE of the failure ("Codex invocation
 * did not complete successfully", "Cursor Agent ended without a terminal
 * result record") and never its cause. The cause is in the process's stderr,
 * which the ledger has been recording all along and the card was throwing
 * away: two runs Colin lost on 2026-09-03 were a folder Codex would not run
 * in and a Cursor account out of capacity, and both read on screen as the
 * same shrug. So the runtime's own last word is always shown, and the one
 * condition whose wording is pure jargon is said in English instead.
 */
export function failureMessage(payload: {
  readonly message: string
  readonly process?: { readonly stderr?: string; readonly exitCode?: number | null }
}): string {
  const said = lastStderrLine(payload.process?.stderr)
  if (said === undefined) return payload.message
  if (EXHAUSTION_PATTERNS.some((pattern) => pattern.test(said))) {
    return `${payload.message} The runtime reported that it is out of capacity right now — its own limit, not this machine's: ${said}`
  }
  return `${payload.message} The runtime's own last word was: ${said}`
}

export function resumableSessionOf(
  events: readonly NormalizedRuntimeEvent[]
): string | undefined {
  for (const event of events) {
    const held = (event as { readonly runtimeThreadId?: unknown }).runtimeThreadId
    if (typeof held === 'string' && held.length > 0) return held
  }
  return undefined
}

/**
 * The words a PERSON typed for this turn.
 *
 * A mission's own prompt is not always something anybody wrote. A route
 * switch starts a new mission whose prompt is the host's briefing, so for
 * that one the typed words are the previous mission's. A follow-up is the
 * opposite: its prompt IS what the person just typed, and reaching past it to
 * the start of the conversation shows them the wrong sentence -- the reply
 * they actually sent appears nowhere, and the opening line appears twice.
 *
 * So this walks back through route switches only, and stops at the first
 * mission whose prompt was written by a person.
 */
export function typedPrompt(
  mission: PublicRecoveredMission,
  byId: ReadonlyMap<string, PublicRecoveredMission>
): string {
  let current = mission
  for (let hops = 0; hops < 32; hops += 1) {
    if (current.continuesFrom?.reason !== 'route-switch') return current.prompt
    const prior = byId.get(current.continuesFrom.missionId)
    if (prior === undefined) return current.prompt
    current = prior
  }
  return current.prompt
}

/**
 * The routes this person has actually run, newest first, as `runtime:model`.
 *
 * The picker puts these at the top. It is a claim the app can back -- these
 * missions are in the ledger -- where "popular" or "recommended" would be a
 * judgement nothing here measured. A model whose id encodes an effort is
 * counted under the id that ran, which is the one they would pick again.
 */
export function recentlyUsedRoutes(
  missions: readonly PublicRecoveredMission[]
): readonly string[] {
  const seen = new Map<string, number>()
  for (const mission of missions) {
    const key = `${mission.runtime}:${mission.model}`
    const at = Date.parse(mission.lastUpdatedAt)
    const stamp = Number.isFinite(at) ? at : 0
    const held = seen.get(key)
    if (held === undefined || stamp > held) seen.set(key, stamp)
  }
  return [...seen.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key)
}
