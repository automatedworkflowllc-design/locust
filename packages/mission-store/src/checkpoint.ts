import { createHash } from 'node:crypto'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import type { MissionLedgerIssue, MissionLedgerMetadata } from './index.js'

/**
 * A checkpoint answers exactly one question, at a provider limit or a route
 * switch: may a different runtime pick this mission up, and if not, why not?
 *
 * It is derived from the durable ledger and from nothing else. In-memory state
 * is precisely what cannot be trusted at a limit -- the process may be dying,
 * the renderer may be showing an optimistic view, and the reason we are here at
 * all is that something went wrong. The ledger is the only record that survived
 * an fsync, so it is the only admissible input.
 */

export const CHECKPOINT_SCHEMA_VERSION = 1 as const

export const MAX_CHECKPOINT_SUMMARY_LENGTH = 4_000
/** Settled actions named in a checkpoint; the most recent are kept. */
export const MAX_SETTLED_NAMES = 40
export const MAX_UNSETTLED_ACTIONS = 64

export type CheckpointReason = 'route-limit' | 'route-switch' | 'manual' | 'shutdown'

/**
 * `unsafe` and `approval-required` are different failures and must not be
 * collapsed. `unsafe` says the ledger cannot be trusted to describe what
 * happened; `approval-required` says the ledger is trustworthy and it reports
 * an action whose outcome is genuinely unknowable from here.
 */
export type CheckpointResumeSafety = 'safe' | 'approval-required' | 'unsafe'

export interface UnsettledAction {
  /** Provider item id, so a human can find the action in the transcript. */
  readonly itemId: string
  readonly toolKind: string
  readonly name: string
  readonly startedAt: string
  /** Event sequence of the `tool.started` that opened it. */
  readonly startedAtSequence: number
}

export interface ReconciledCheckpoint {
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION
  readonly missionId: string
  readonly runId: string
  /** 1 for the first checkpoint of a mission, incrementing thereafter. */
  readonly epoch: number
  readonly reason: CheckpointReason
  /**
   * The last event sequence this checkpoint accounts for. There is deliberately
   * no second "resume from" field: it would be this number plus one, and two
   * fields stating one quantity drift apart the moment either is edited.
   */
  readonly reconciledThroughSequence: number
  /** Item ids of tool calls that reached a terminal event. */
  readonly settledActions: readonly string[]
  /**
   * The same actions named by what they did -- `command: npm test` -- for
   * those whose start was recorded, in order, at most MAX_SETTLED_NAMES
   * (A2.11: a handoff brief listed the ids, `call_8f2...`, which tell the next
   * runtime nothing). Absent on a checkpoint written before it existed.
   */
  readonly settledNames?: readonly string[]
  /** Tool calls that started and never reported an outcome. */
  readonly unsettledActions: readonly UnsettledAction[]
  readonly resumeSafety: CheckpointResumeSafety
  /** Plain-language cause, safe to show a user. */
  readonly safetyReason: string
  /**
   * SHA-256 over the covered event ids and sequences. A destination runtime
   * that rehydrates a transcript can prove it rehydrated *this* one rather
   * than assuming it did.
   */
  readonly transcriptDigest: string
  /** The last complete assistant message, bounded. Empty when there is none. */
  readonly assistantSummary: string
  readonly runtimeThreadId?: string
  readonly createdAt: string
}

export interface ReconcileMissionInput {
  readonly metadata: MissionLedgerMetadata
  readonly events: readonly NormalizedRuntimeEvent[]
  /**
   * Recovery issues for this mission. A non-empty list means the reader stopped
   * early and later records were dropped, so the event list is a prefix of what
   * actually happened -- which is not a safe thing to resume from.
   */
  readonly issues: readonly MissionLedgerIssue[]
}

export interface ReconcileMissionOptions {
  readonly reason: CheckpointReason
  readonly epoch: number
  readonly createdAt: string
}

const REASONS: ReadonlySet<string> = new Set<CheckpointReason>([
  'route-limit',
  'route-switch',
  'manual',
  'shutdown'
])

function boundedSummary(value: string): string {
  const clean = value.includes('\u0000') ? value.replace(/\u0000/g, '') : value
  return clean.length > MAX_CHECKPOINT_SUMMARY_LENGTH
    ? clean.slice(0, MAX_CHECKPOINT_SUMMARY_LENGTH)
    : clean
}

/**
 * Rebuild the assistant text the way the transcript did, rather than taking the
 * last delta's text. Deltas carry an `append` or `replace` operation against a
 * per-item buffer, so the final message of an appended stream is the joined
 * buffer -- reading only the last delta returns its final fragment.
 */
function assistantSummaryFor(events: readonly NormalizedRuntimeEvent[]): string {
  const buffers = new Map<string, string>()
  let latestFinal: string | undefined
  for (const event of events) {
    if (event.type !== 'message.delta') continue
    const { itemId, operation, text, final } = event.payload
    const next = operation === 'replace' ? text : `${buffers.get(itemId) ?? ''}${text}`
    buffers.set(itemId, next)
    if (final) latestFinal = next
  }
  return boundedSummary(latestFinal ?? '')
}

/**
 * Unit separator. Built from a char code rather than typed: a literal control
 * byte in source renders as nothing, so the delimiter this digest depends on
 * would be invisible to the next person reading the line -- and to anyone
 * grepping for why two transcripts hashed alike after it was accidentally
 * deleted.
 */
const SEP = String.fromCharCode(31)

function transcriptDigestFor(events: readonly NormalizedRuntimeEvent[]): string {
  const hash = createHash('sha256')
  for (const event of events) {
    // Separated, not concatenated: sequence 1 with id `2a` and sequence 12 with
    // id `a` produce identical bytes without a delimiter, so two different
    // transcripts would agree on the digest whose only job is telling them apart.
    hash.update(
      `${event.sequence}${SEP}${event.id}${SEP}${event.type}${SEP}`
    )
  }
  return hash.digest('hex')
}

/**
 * A finished action, named by what it ran (0.567).
 *
 * `toolKind: name` alone handed Codex forty lines of `run_command:
 * run_command` and `view_file: view_file` when Colin moved a W7 conversation
 * off Antigravity (2026-10-03): that adapter names the tool twice and keeps
 * what it ran -- the command line, the file read or written -- in `command`,
 * which is the part that says what was done.
 */
function actionNameOf(payload: { readonly toolKind: string; readonly name: string; readonly command?: string; readonly title?: string }): string {
  const head = payload.name === payload.toolKind ? payload.name : `${payload.toolKind}: ${payload.name}`
  const what = (payload.command ?? payload.title)?.replace(/\s+/g, ' ').trim()
  return (what === undefined || what.length === 0 || what === payload.name ? head : `${head}: ${what}`).slice(0, 300)
}

/**
 * Derive a checkpoint from durably recorded state. Pure: same events in, same
 * checkpoint out, no clock and no filesystem.
 */
export function reconcileMission(
  input: ReconcileMissionInput,
  options: ReconcileMissionOptions
): ReconciledCheckpoint {
  const { metadata, events, issues } = input

  // A tool call is settled when it reports an outcome. One that started and
  // never did is the whole reason this function exists: its external effect
  // may or may not have happened, and no amount of local reasoning can settle
  // that. Retrying it elsewhere is how a mission sends an email twice.
  const open = new Map<string, UnsettledAction>()
  const settled = new Set<string>()
  const started = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool.started') {
      const { itemId, toolKind, name } = event.payload
      started.set(itemId, actionNameOf(event.payload))
      open.set(itemId, {
        itemId,
        toolKind,
        name,
        startedAt: event.occurredAt,
        startedAtSequence: event.sequence
      })
      continue
    }
    if (event.type !== 'tool.completed' && event.type !== 'tool.failed') continue
    // Settled on the OUTCOME, not on having seen the start. A recovered ledger
    // can begin mid-stream, and an action that reported an outcome is settled
    // whether or not its opening event survived -- keying off the start would
    // silently drop it from the record a human reconciles against.
    open.delete(event.payload.itemId)
    settled.add(event.payload.itemId)
  }

  const unsettledActions = [...open.values()]
    .sort((a, b) => a.startedAtSequence - b.startedAtSequence)
    .slice(0, MAX_UNSETTLED_ACTIONS)

  let resumeSafety: CheckpointResumeSafety
  let safetyReason: string
  if (issues.length > 0) {
    resumeSafety = 'unsafe'
    safetyReason =
      'The mission ledger stopped short of its end during recovery, so the recorded history is incomplete.'
  } else if (unsettledActions.length > 0) {
    resumeSafety = 'approval-required'
    safetyReason =
      unsettledActions.length === 1
        ? 'One action started and never reported an outcome, so whether it took effect is unknown.'
        : `${unsettledActions.length} actions started and never reported an outcome, so whether they took effect is unknown.`
  } else {
    resumeSafety = 'safe'
    safetyReason = 'Every recorded action reported an outcome and the ledger was read to its end.'
  }

  const runtimeThreadId = events.find((event) => event.runtimeThreadId !== undefined)?.runtimeThreadId

  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    missionId: metadata.missionId,
    runId: metadata.runId,
    epoch: options.epoch,
    reason: options.reason,
    reconciledThroughSequence: events.at(-1)?.sequence ?? 0,
    settledActions: [...settled],
    settledNames: [...settled].flatMap((id) => (started.has(id) ? [started.get(id)!] : [])).slice(-MAX_SETTLED_NAMES),
    unsettledActions,
    resumeSafety,
    safetyReason,
    transcriptDigest: transcriptDigestFor(events),
    assistantSummary: assistantSummaryFor(events),
    ...(runtimeThreadId === undefined ? {} : { runtimeThreadId }),
    createdAt: options.createdAt
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\u0000')
}

function isNonemptyBoundedText(value: unknown, maximum: number): value is string {
  return isBoundedText(value, maximum) && value.length > 0
}

function isCount(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum
}

function parsedUnsettledAction(value: unknown): UnsettledAction | undefined {
  if (!isObject(value)) return undefined
  if (
    !isNonemptyBoundedText(value.itemId, 512)
    || !isNonemptyBoundedText(value.toolKind, 512)
    || !isNonemptyBoundedText(value.name, 512)
    || !isNonemptyBoundedText(value.startedAt, 128)
    || !Number.isFinite(Date.parse(value.startedAt))
    || !isCount(value.startedAtSequence, 1)
  ) return undefined
  return value as unknown as UnsettledAction
}

/**
 * The reader's definition of a valid checkpoint. The writer runs this before
 * appending, so a checkpoint that could not be read back is never written --
 * recovery stops at the first record it cannot parse, and a checkpoint the
 * reader refuses would silently discard every later record of the mission.
 */
export function parsedCheckpoint(
  value: unknown,
  metadata: MissionLedgerMetadata
): ReconciledCheckpoint | undefined {
  if (!isObject(value)) return undefined
  if (
    value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION
    || value.missionId !== metadata.missionId
    || value.runId !== metadata.runId
    || !isCount(value.epoch, 1)
    || typeof value.reason !== 'string'
    || !REASONS.has(value.reason)
    || !isCount(value.reconciledThroughSequence, 0)
    || !Array.isArray(value.settledActions)
    || !Array.isArray(value.unsettledActions)
    || value.unsettledActions.length > MAX_UNSETTLED_ACTIONS
    || (value.resumeSafety !== 'safe'
      && value.resumeSafety !== 'approval-required'
      && value.resumeSafety !== 'unsafe')
    || !isNonemptyBoundedText(value.safetyReason, 1_024)
    || !isBoundedText(value.assistantSummary, MAX_CHECKPOINT_SUMMARY_LENGTH)
    || !/^[0-9a-f]{64}$/.test(String(value.transcriptDigest))
    || !isNonemptyBoundedText(value.createdAt, 128)
    || !Number.isFinite(Date.parse(value.createdAt))
    || (value.runtimeThreadId !== undefined && !isBoundedText(value.runtimeThreadId, 2_048))
  ) return undefined
  if (!value.settledActions.every((entry) => isNonemptyBoundedText(entry, 512))) return undefined
  if (
    value.settledNames !== undefined
    && (!Array.isArray(value.settledNames)
      || value.settledNames.length > MAX_SETTLED_NAMES
      || !value.settledNames.every((entry) => isNonemptyBoundedText(entry, 512)))
  ) return undefined
  if (!value.unsettledActions.every((entry) => parsedUnsettledAction(entry) !== undefined)) {
    return undefined
  }
  // A checkpoint that claims safety while listing an unknown action is the one
  // lie that would defeat the whole mechanism, so it is refused at the door
  // rather than trusted because it parsed.
  if (value.resumeSafety === 'safe' && value.unsettledActions.length > 0) return undefined
  return value as unknown as ReconciledCheckpoint
}
