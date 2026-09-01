import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

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
  let runningStep: { label: string; detail: string | undefined } | undefined

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
          detail: event.payload.itemType
        }
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

  if (activity.length > 0) {
    items.push({
      key: 'activity',
      type: 'activity',
      summary: activitySummary(activity),
      details: activity
    })
  }

  for (const message of assistantMessages(events)) {
    if (message.text.length === 0) continue
    items.push({
      key: `msg_${message.itemId}`,
      type: 'agent-message',
      text: message.text,
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
      detail: runningStep.detail
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
