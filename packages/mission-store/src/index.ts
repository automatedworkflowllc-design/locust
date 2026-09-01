import type {
  NormalizedRuntimeEvent,
  NormalizedRuntimeEventType,
  RedactedJsonValue
} from '@teammate/runtime-adapters'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open, readdir, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { parsedCheckpoint, reconcileMission } from './checkpoint.js'
import type { CheckpointReason, ReconciledCheckpoint } from './checkpoint.js'

export const MISSION_LEDGER_SCHEMA_VERSION = 1 as const

const MAX_PROMPT_LENGTH = 8_000
const MAX_TEXT_LENGTH = 16_384
const MAX_RECORD_BYTES = 512 * 1024
const MAX_APPEND_BYTES = 2 * 1024 * 1024
const MAX_LEDGER_BYTES = 64 * 1024 * 1024
const MAX_MISSION_FILES = 500
const DEFAULT_MISSION_LIST_LIMIT = 20
const MAX_EVENTS_PER_APPEND = 100
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
const NORMALIZED_EVENT_TYPES = new Set<NormalizedRuntimeEventType>([
  'run.started',
  'plan.updated',
  'message.delta',
  'step.started',
  'step.completed',
  'step.failed',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'route.limit_detected',
  'run.cancelled',
  'run.failed',
  'run.completed',
  'adapter.diagnostic'
])
const NO_FOLLOW = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
const READ_FLAGS = fsConstants.O_RDONLY | NO_FOLLOW
const APPEND_FLAGS = fsConstants.O_WRONLY | fsConstants.O_APPEND | NO_FOLLOW

export interface MissionLedgerMetadata {
  readonly missionId: string
  readonly runId: string
  readonly prompt: string
  readonly runtime: 'codex'
  readonly model: 'account-default'
  readonly requestedRouteId: string
  readonly resolvedRouteId: string
  readonly cliVersion: string | null
  readonly workspaceId: string
  readonly sandbox: 'read-only'
  readonly executionPolicyVersion: 1
  readonly createdAt: string
}

export type MissionHostFailureCode = 'runtime-start-failed' | 'runtime-transport-failed'

export interface MissionHostFailure {
  readonly code: MissionHostFailureCode
  readonly message: string
  readonly occurredAt: string
}

export type RecoveredMissionPhase = 'completed' | 'failed' | 'cancelled' | 'interrupted'

export type MissionLedgerIssueCode =
  | 'file-limit-exceeded'
  | 'file-too-large'
  | 'read-failed'
  | 'truncated-tail'
  | 'invalid-record'
  | 'unsupported-schema'

export interface MissionLedgerIssue {
  readonly code: MissionLedgerIssueCode
  readonly missionId?: string
  readonly message: string
}

export interface RecoveredMission {
  readonly metadata: MissionLedgerMetadata
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly hostFailures: readonly MissionHostFailure[]
  /** Reconciled checkpoints in ledger order; the last one is the newest. */
  readonly checkpoints: readonly ReconciledCheckpoint[]
  readonly phase: RecoveredMissionPhase
  readonly lastUpdatedAt: string
  readonly ledgerSequence: number
  readonly issues: readonly MissionLedgerIssue[]
}

export interface MissionLedgerSnapshot {
  readonly missions: readonly RecoveredMission[]
  readonly issues: readonly MissionLedgerIssue[]
}

export interface MissionLedger {
  createMission(metadata: MissionLedgerMetadata): Promise<void>
  appendEvents(missionId: string, events: readonly NormalizedRuntimeEvent[]): Promise<void>
  appendHostFailure(missionId: string, failure: MissionHostFailure): Promise<void>
  /**
   * Derive a checkpoint from what is durably recorded and append it.
   *
   * There is deliberately no `appendCheckpoint(checkpoint)`. A caller that
   * could hand in its own checkpoint could hand in one that disagrees with
   * the ledger -- and a checkpoint whose whole purpose is to be trusted at a
   * provider limit is worthless the moment it can be authored by the
   * component whose state is in doubt.
   *
   * The returned checkpoint is durable EXCEPT when it reports `unsafe`: a
   * ledger that already stops short during recovery cannot receive a record
   * anyone would read again, so that verdict is returned without being written.
   */
  createCheckpoint(missionId: string, reason: CheckpointReason): Promise<ReconciledCheckpoint>
  getMission(missionId: string): Promise<RecoveredMission | undefined>
  listMissions(options?: MissionLedgerListOptions): Promise<MissionLedgerSnapshot>
  flush(): Promise<void>
}

export interface MissionLedgerListOptions {
  readonly limit?: number
}

export interface FileMissionLedgerOptions {
  readonly rootDirectory: string
  /** Test seam. Checkpoints are stamped by the ledger, never by a caller. */
  readonly now?: () => Date
}

interface CreatedRecord {
  readonly schemaVersion: typeof MISSION_LEDGER_SCHEMA_VERSION
  readonly recordType: 'mission.created'
  readonly ledgerSequence: 1
  readonly occurredAt: string
  readonly metadata: MissionLedgerMetadata
}

interface EventRecord {
  readonly schemaVersion: typeof MISSION_LEDGER_SCHEMA_VERSION
  readonly recordType: 'mission.event'
  readonly ledgerSequence: number
  readonly occurredAt: string
  readonly event: NormalizedRuntimeEvent
}

interface HostFailureRecord {
  readonly schemaVersion: typeof MISSION_LEDGER_SCHEMA_VERSION
  readonly recordType: 'mission.host_failure'
  readonly ledgerSequence: number
  readonly occurredAt: string
  readonly failure: MissionHostFailure
}

interface CheckpointRecord {
  readonly schemaVersion: typeof MISSION_LEDGER_SCHEMA_VERSION
  readonly recordType: 'mission.checkpoint'
  readonly ledgerSequence: number
  readonly occurredAt: string
  readonly checkpoint: ReconciledCheckpoint
}

type LedgerRecord = CreatedRecord | EventRecord | HostFailureRecord | CheckpointRecord
type JsonObject = Record<string, unknown>

interface ParsedLedger {
  readonly mission?: RecoveredMission
  readonly issues: readonly MissionLedgerIssue[]
  readonly nextSequence?: number
  readonly nextEventSequence?: number
  readonly byteLength?: number
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireSafeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function requireText(value: string, label: string, maximum = MAX_TEXT_LENGTH): string {
  if (!value.trim() || value.length > maximum || value.includes('\0')) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function requireTimestamp(value: string, label: string): string {
  requireText(value, label, 128)
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`)
  return value
}

function validateMetadata(metadata: MissionLedgerMetadata): MissionLedgerMetadata {
  requireSafeId(metadata.missionId, 'missionId')
  requireSafeId(metadata.runId, 'runId')
  requireText(metadata.prompt, 'prompt', MAX_PROMPT_LENGTH)
  requireText(metadata.requestedRouteId, 'requestedRouteId', 256)
  requireText(metadata.resolvedRouteId, 'resolvedRouteId', 256)
  if (metadata.runtime !== 'codex' || metadata.model !== 'account-default') {
    throw new Error('Mission runtime metadata is invalid')
  }
  if (metadata.cliVersion !== null) requireText(metadata.cliVersion, 'cliVersion', 256)
  requireSafeId(metadata.workspaceId, 'workspaceId')
  if (metadata.sandbox !== 'read-only' || metadata.executionPolicyVersion !== 1) {
    throw new Error('Mission execution policy is invalid')
  }
  requireTimestamp(metadata.createdAt, 'createdAt')
  return metadata
}

function validateFailure(failure: MissionHostFailure): MissionHostFailure {
  if (failure.code !== 'runtime-start-failed' && failure.code !== 'runtime-transport-failed') {
    throw new Error('Host failure code is invalid')
  }
  requireText(failure.message, 'Host failure message', 1_024)
  requireTimestamp(failure.occurredAt, 'Host failure timestamp')
  return failure
}

function recordLine(record: LedgerRecord): string {
  const line = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
    throw new Error('Mission ledger record exceeds its safety limit')
  }
  return line
}

function missionPath(rootDirectory: string, missionId: string): string {
  return join(rootDirectory, `${requireSafeId(missionId, 'missionId')}.jsonl`)
}

function publicIssue(
  code: MissionLedgerIssueCode,
  message: string,
  missionId?: string
): MissionLedgerIssue {
  return {
    code,
    ...(missionId === undefined ? {} : { missionId }),
    message
  }
}

function parsedMetadata(value: unknown): MissionLedgerMetadata | undefined {
  if (!isObject(value)) return undefined
  const candidate = value as Partial<MissionLedgerMetadata>
  if (
    typeof candidate.missionId !== 'string'
    || typeof candidate.runId !== 'string'
    || typeof candidate.prompt !== 'string'
    || candidate.runtime !== 'codex'
    || candidate.model !== 'account-default'
    || typeof candidate.requestedRouteId !== 'string'
    || typeof candidate.resolvedRouteId !== 'string'
    || !(candidate.cliVersion === null || typeof candidate.cliVersion === 'string')
    || typeof candidate.workspaceId !== 'string'
    || candidate.sandbox !== 'read-only'
    || candidate.executionPolicyVersion !== 1
    || typeof candidate.createdAt !== 'string'
  ) return undefined
  try {
    return validateMetadata(candidate as MissionLedgerMetadata)
  } catch {
    return undefined
  }
}

function isText(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length <= maximum && !value.includes('\0')
}

function isNonemptyText(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  return isText(value, maximum) && value.trim().length > 0
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && !value.includes('\0')
    && Number.isFinite(Date.parse(value))
}

function isOptionalText(value: unknown, maximum = MAX_TEXT_LENGTH): boolean {
  return value === undefined || isText(value, maximum)
}

function isRedactedJson(value: unknown, depth = 0): value is RedactedJsonValue {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= MAX_TEXT_LENGTH && !value.includes('\0')
  if (Array.isArray(value)) {
    return value.length <= 100 && value.every((entry) => isRedactedJson(entry, depth + 1))
  }
  if (!isObject(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 100
    && entries.every(([key, entry]) => isText(key, 512) && isRedactedJson(entry, depth + 1))
}

function isEvidence(value: unknown): boolean {
  if (!isObject(value) || typeof value.redacted !== 'boolean') return false
  if (value.transportSequence !== undefined
    && (!Number.isSafeInteger(value.transportSequence) || (value.transportSequence as number) < 1)) return false
  if (!isOptionalText(value.runtimeEventType, 512)) return false
  return value.raw === undefined || isRedactedJson(value.raw)
}

function isProcessEvidence(value: unknown): boolean {
  if (!isObject(value)) return false
  return (value.exitCode === null || Number.isSafeInteger(value.exitCode))
    && (value.signal === null || isNonemptyText(value.signal, 64))
    && isText(value.stderr, MAX_RECORD_BYTES)
    && typeof value.stderrTruncated === 'boolean'
    && Number.isSafeInteger(value.recordCount)
    && (value.recordCount as number) >= 0
    && typeof value.inputDeliveryFailed === 'boolean'
    && typeof value.outputLimitExceeded === 'boolean'
    && typeof value.forcedTerminationAttempted === 'boolean'
    && typeof value.terminationUnconfirmed === 'boolean'
    && isTimestamp(value.startedAt)
    && isTimestamp(value.finishedAt)
}

function isStepPayload(value: JsonObject): boolean {
  return (value.stepKind === 'turn' || value.stepKind === 'reasoning' || value.stepKind === 'item')
    && isOptionalText(value.itemId, 512)
    && isOptionalText(value.itemType, 512)
    && isOptionalText(value.status, 512)
    && isOptionalText(value.message)
    && isEvidence(value.evidence)
}

function isToolPayload(value: JsonObject): boolean {
  return isNonemptyText(value.itemId, 512)
    && isNonemptyText(value.toolKind, 512)
    && isNonemptyText(value.name, 512)
    && isOptionalText(value.command)
    && (value.output === undefined || isRedactedJson(value.output))
    && (value.exitCode === undefined || Number.isSafeInteger(value.exitCode))
    && isOptionalText(value.status, 512)
    && (value.phase === 'started' || value.phase === 'updated' || value.phase === 'completed')
    && isEvidence(value.evidence)
}

function isEventPayload(type: NormalizedRuntimeEventType, value: JsonObject): boolean {
  if (type === 'run.started') {
    return isNonemptyText(value.runtimeThreadId, 2_048) && isEvidence(value.evidence)
  }
  if (type === 'plan.updated') {
    return isNonemptyText(value.itemId, 512)
      && isRedactedJson(value.plan)
      && typeof value.final === 'boolean'
      && isEvidence(value.evidence)
  }
  if (type === 'message.delta') {
    return isNonemptyText(value.itemId, 512)
      && (value.operation === 'append' || value.operation === 'replace')
      && isText(value.text)
      && typeof value.final === 'boolean'
      && isEvidence(value.evidence)
  }
  if (type === 'step.started' || type === 'step.completed' || type === 'step.failed') {
    return isStepPayload(value)
  }
  if (type === 'tool.started' || type === 'tool.completed' || type === 'tool.failed') {
    return isToolPayload(value)
  }
  if (type === 'route.limit_detected') {
    return (value.kind === 'quota-exhausted' || value.kind === 'temporary-rate-limit')
      && isNonemptyText(value.message)
      && isEvidence(value.evidence)
  }
  if (type === 'adapter.diagnostic') {
    return (value.level === 'info' || value.level === 'warning' || value.level === 'error')
      && isNonemptyText(value.code, 512)
      && isNonemptyText(value.message)
      && value.terminal === false
      && isEvidence(value.evidence)
  }
  if (type === 'run.completed') {
    return isOptionalText(value.runtimeThreadId, 2_048)
      && (value.usage === undefined || isRedactedJson(value.usage))
      && isProcessEvidence(value.process)
  }
  if (type === 'run.cancelled') {
    return isOptionalText(value.runtimeThreadId, 2_048) && isProcessEvidence(value.process)
  }
  return (value.kind === 'quota-exhausted'
      || value.kind === 'temporary-rate-limit'
      || value.kind === 'authentication-failed'
      || value.kind === 'safety-blocked'
      || value.kind === 'process-failed'
      || value.kind === 'protocol-mismatch'
      || value.kind === 'unknown')
    && isNonemptyText(value.message)
    && isOptionalText(value.runtimeThreadId, 2_048)
    && (value.runtimeTerminal === 'completed' || value.runtimeTerminal === 'failed' || value.runtimeTerminal === 'missing')
    && isProcessEvidence(value.process)
}

function parsedEvent(value: unknown, metadata: MissionLedgerMetadata): NormalizedRuntimeEvent | undefined {
  if (!isObject(value)) return undefined
  if (
    !isNonemptyText(value.id, 512)
    || value.runId !== metadata.runId
    || value.missionId !== metadata.missionId
    || !Number.isSafeInteger(value.sequence)
    || (value.sequence as number) < 1
    || typeof value.type !== 'string'
    || !NORMALIZED_EVENT_TYPES.has(value.type as NormalizedRuntimeEventType)
    || !isTimestamp(value.occurredAt)
    || value.sourceAdapter !== 'codex'
    || !isObject(value.payload)
    || !isOptionalText(value.cliVersion, 256)
    || !isOptionalText(value.requestedRouteId, 256)
    || !isOptionalText(value.resolvedRouteId, 256)
    || !isOptionalText(value.runtimeThreadId, 2_048)
  ) return undefined
  if (!isEventPayload(value.type as NormalizedRuntimeEventType, value.payload)) return undefined
  return value as unknown as NormalizedRuntimeEvent
}

function parsedFailure(value: unknown): MissionHostFailure | undefined {
  if (!isObject(value)) return undefined
  const candidate = value as Partial<MissionHostFailure>
  if (
    (candidate.code !== 'runtime-start-failed' && candidate.code !== 'runtime-transport-failed')
    || typeof candidate.message !== 'string'
    || typeof candidate.occurredAt !== 'string'
  ) return undefined
  try {
    return validateFailure(candidate as MissionHostFailure)
  } catch {
    return undefined
  }
}

function phaseFor(
  events: readonly NormalizedRuntimeEvent[],
  failures: readonly MissionHostFailure[]
): RecoveredMissionPhase {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'run.completed') return 'completed'
    if (event?.type === 'run.cancelled') return 'cancelled'
    if (event?.type === 'run.failed') return 'failed'
  }
  return failures.length > 0 ? 'failed' : 'interrupted'
}

async function readLedgerFile(path: string, missionId: string): Promise<ParsedLedger> {
  const issues: MissionLedgerIssue[] = []
  let handle: FileHandle
  try {
    handle = await open(path, READ_FLAGS)
  } catch {
    return { issues: [publicIssue('read-failed', 'A mission ledger could not be read.', missionId)] }
  }

  let text: string
  try {
    const file = await handle.stat()
    if (!file.isFile()) {
      return { issues: [publicIssue('read-failed', 'A mission ledger was not a regular file.', missionId)] }
    }
    if (file.size > MAX_LEDGER_BYTES) {
      return { issues: [publicIssue('file-too-large', 'A mission ledger exceeded the local safety limit.', missionId)] }
    }
    text = await handle.readFile('utf8')
  } catch {
    return { issues: [publicIssue('read-failed', 'A mission ledger could not be read.', missionId)] }
  } finally {
    await handle.close().catch(() => undefined)
  }

  const hasTrailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (!hasTrailingNewline && lines.length > 0) {
    lines.pop()
    issues.push(publicIssue(
      'truncated-tail',
      'An incomplete final ledger record was ignored after recovery.',
      missionId
    ))
  }
  if (lines.length === 0) {
    issues.push(publicIssue('invalid-record', 'The mission ledger did not contain a valid header.', missionId))
    return { issues }
  }

  let headerValue: unknown
  try {
    headerValue = JSON.parse(lines[0] ?? '') as unknown
  } catch {
    issues.push(publicIssue('invalid-record', 'The mission ledger header was invalid.', missionId))
    return { issues }
  }
  if (!isObject(headerValue)) {
    issues.push(publicIssue('invalid-record', 'The mission ledger header was invalid.', missionId))
    return { issues }
  }
  if (headerValue.schemaVersion !== MISSION_LEDGER_SCHEMA_VERSION) {
    issues.push(publicIssue('unsupported-schema', 'The mission ledger uses an unsupported schema.', missionId))
    return { issues }
  }
  const metadata = parsedMetadata(headerValue.metadata)
  if (
    headerValue.recordType !== 'mission.created'
    || headerValue.ledgerSequence !== 1
    || headerValue.occurredAt !== metadata?.createdAt
    || metadata === undefined
    || metadata.missionId !== missionId
  ) {
    issues.push(publicIssue('invalid-record', 'The mission ledger header was invalid.', missionId))
    return { issues }
  }

  const events: NormalizedRuntimeEvent[] = []
  const hostFailures: MissionHostFailure[] = []
  const checkpoints: ReconciledCheckpoint[] = []
  let expectedSequence = 2
  let expectedEventSequence = 1
  let lastUpdatedAt = metadata.createdAt
  for (const line of lines.slice(1)) {
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
      issues.push(publicIssue('invalid-record', 'An oversized mission record and its tail were ignored.', missionId))
      break
    }
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      issues.push(publicIssue('invalid-record', 'An invalid mission record and its tail were ignored.', missionId))
      break
    }
    if (
      !isObject(value)
      || value.schemaVersion !== MISSION_LEDGER_SCHEMA_VERSION
      || value.ledgerSequence !== expectedSequence
      || !isTimestamp(value.occurredAt)
    ) {
      issues.push(publicIssue('invalid-record', 'A noncontiguous mission record and its tail were ignored.', missionId))
      break
    }

    if (value.recordType === 'mission.event') {
      const event = parsedEvent(value.event, metadata)
      if (
        event === undefined
        || event.sequence !== expectedEventSequence
        || value.occurredAt !== event.occurredAt
      ) {
        issues.push(publicIssue('invalid-record', 'An invalid mission event and its tail were ignored.', missionId))
        break
      }
      events.push(event)
      expectedEventSequence += 1
      lastUpdatedAt = event.occurredAt
    } else if (value.recordType === 'mission.host_failure') {
      const failure = parsedFailure(value.failure)
      if (failure === undefined || value.occurredAt !== failure.occurredAt) {
        issues.push(publicIssue('invalid-record', 'An invalid host failure and its tail were ignored.', missionId))
        break
      }
      hostFailures.push(failure)
      lastUpdatedAt = failure.occurredAt
    } else if (value.recordType === 'mission.checkpoint') {
      const checkpoint = parsedCheckpoint(value.checkpoint, metadata)
      if (
        checkpoint === undefined
        || value.occurredAt !== checkpoint.createdAt
        || checkpoint.epoch !== checkpoints.length + 1
        || checkpoint.reconciledThroughSequence > expectedEventSequence - 1
      ) {
        issues.push(publicIssue('invalid-record', 'An invalid checkpoint and its tail were ignored.', missionId))
        break
      }
      checkpoints.push(checkpoint)
      lastUpdatedAt = checkpoint.createdAt
    } else {
      issues.push(publicIssue('invalid-record', 'An unknown mission record and its tail were ignored.', missionId))
      break
    }
    expectedSequence += 1
  }

  return {
    mission: {
      metadata,
      events,
      hostFailures,
      checkpoints,
      phase: phaseFor(events, hostFailures),
      lastUpdatedAt,
      ledgerSequence: expectedSequence - 1,
      issues
    },
    issues,
    nextSequence: expectedSequence,
    nextEventSequence: expectedEventSequence,
    byteLength: Buffer.byteLength(text, 'utf8')
  }
}

async function syncDirectoryBestEffort(path: string): Promise<void> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, fsConstants.O_RDONLY)
    await handle.sync()
  } catch {
    // Windows does not consistently allow directory handles. The file itself is
    // still fsynced; POSIX hosts also commit the new directory entry here.
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export function createFileMissionLedger(options: FileMissionLedgerOptions): MissionLedger {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory) || rootDirectory.includes('\0')) {
    throw new Error('Mission ledger directory is invalid')
  }

  const now = options.now ?? (() => new Date())

  const nextSequences = new Map<string, number>()
  const nextEventSequences = new Map<string, number>()
  const nextByteOffsets = new Map<string, number>()
  const metadataByMission = new Map<string, MissionLedgerMetadata>()
  let directoryReady: Promise<void> | undefined
  let writeTail: Promise<void> = Promise.resolve()

  const ensureDirectory = (): Promise<void> => {
    directoryReady ??= mkdir(rootDirectory, { recursive: true, mode: 0o700 }).then(() => undefined)
    return directoryReady
  }

  const invalidateCaches = (missionId: string): void => {
    nextSequences.delete(missionId)
    nextEventSequences.delete(missionId)
    nextByteOffsets.delete(missionId)
    metadataByMission.delete(missionId)
  }

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeTail.then(operation)
    writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  const hydrateForAppend = async (missionId: string): Promise<{
    readonly metadata: MissionLedgerMetadata
    readonly nextSequence: number
    readonly nextEventSequence: number
    readonly byteLength: number
  }> => {
    const cachedMetadata = metadataByMission.get(missionId)
    const cachedSequence = nextSequences.get(missionId)
    const cachedEventSequence = nextEventSequences.get(missionId)
    const cachedByteLength = nextByteOffsets.get(missionId)
    if (
      cachedMetadata !== undefined
      && cachedSequence !== undefined
      && cachedEventSequence !== undefined
      && cachedByteLength !== undefined
    ) {
      return {
        metadata: cachedMetadata,
        nextSequence: cachedSequence,
        nextEventSequence: cachedEventSequence,
        byteLength: cachedByteLength
      }
    }
    await ensureDirectory()
    const parsed = await readLedgerFile(missionPath(rootDirectory, missionId), missionId)
    if (
      parsed.mission === undefined
      || parsed.nextSequence === undefined
      || parsed.nextEventSequence === undefined
      || parsed.byteLength === undefined
      || parsed.issues.length > 0
    ) {
      throw new Error('Mission ledger is unavailable')
    }
    metadataByMission.set(missionId, parsed.mission.metadata)
    nextSequences.set(missionId, parsed.nextSequence)
    nextEventSequences.set(missionId, parsed.nextEventSequence)
    nextByteOffsets.set(missionId, parsed.byteLength)
    return {
      metadata: parsed.mission.metadata,
      nextSequence: parsed.nextSequence,
      nextEventSequence: parsed.nextEventSequence,
      byteLength: parsed.byteLength
    }
  }

  const appendRecords = async (missionId: string, records: readonly LedgerRecord[]): Promise<void> => {
    const lines = records.map(recordLine).join('')
    const appendBytes = Buffer.byteLength(lines, 'utf8')
    if (appendBytes > MAX_APPEND_BYTES) {
      throw new Error('Mission ledger append exceeds its safety limit')
    }
    const expectedBytes = nextByteOffsets.get(missionId)
    if (expectedBytes === undefined) throw new Error('Mission ledger offset is unavailable')
    try {
      const handle = await open(missionPath(rootDirectory, missionId), APPEND_FLAGS, 0o600)
      try {
        const file = await handle.stat()
        if (!file.isFile() || file.size !== expectedBytes) {
          throw new Error('Mission ledger changed outside the active writer')
        }
        if (file.size + appendBytes > MAX_LEDGER_BYTES) {
          throw new Error('Mission ledger exceeds its safety limit')
        }
        await handle.writeFile(lines, 'utf8')
        await handle.sync()
        nextByteOffsets.set(missionId, file.size + appendBytes)
      } finally {
        await handle.close()
      }
    } catch (error) {
      // The on-disk state is now uncertain (a write may have landed without its
      // sync, or the file changed externally). Drop the cached offsets so the
      // next append re-hydrates from the file instead of wedging the mission.
      invalidateCaches(missionId)
      throw error
    }
  }

  return {
    createMission(metadata: MissionLedgerMetadata): Promise<void> {
      return serialize(async () => {
        validateMetadata(metadata)
        await ensureDirectory()
        const record: CreatedRecord = {
          schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
          recordType: 'mission.created',
          ledgerSequence: 1,
          occurredAt: metadata.createdAt,
          metadata
        }
        const line = recordLine(record)
        const handle = await open(missionPath(rootDirectory, metadata.missionId), 'wx', 0o600)
        try {
          await handle.writeFile(line, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        await syncDirectoryBestEffort(rootDirectory)
        metadataByMission.set(metadata.missionId, metadata)
        nextSequences.set(metadata.missionId, 2)
        nextEventSequences.set(metadata.missionId, 1)
        nextByteOffsets.set(metadata.missionId, Buffer.byteLength(line, 'utf8'))
      })
    },

    appendEvents(
      missionId: string,
      events: readonly NormalizedRuntimeEvent[]
    ): Promise<void> {
      return serialize(async () => {
        requireSafeId(missionId, 'missionId')
        if (events.length === 0) return
        if (events.length > MAX_EVENTS_PER_APPEND) {
          throw new Error('Too many mission events in one append')
        }
        const hydrated = await hydrateForAppend(missionId)
        let sequence = hydrated.nextSequence
        let eventSequence = hydrated.nextEventSequence
        const records: EventRecord[] = events.map((event) => {
          if (event.missionId !== missionId || event.runId !== hydrated.metadata.runId) {
            throw new Error('Mission event correlation is invalid')
          }
          if (event.sequence !== eventSequence) {
            throw new Error('Mission event sequence is invalid')
          }
          // Writer strictness is defined BY the reader, not agreed with it. An
          // event the reader would refuse is unwritable: recovery stops at the
          // first record it cannot parse, so accepting one here would silently
          // discard every later record of an otherwise intact mission.
          if (parsedEvent(event, hydrated.metadata) === undefined) {
            throw new Error('Mission event is not readable by the ledger reader')
          }
          const record: EventRecord = {
            schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
            recordType: 'mission.event',
            ledgerSequence: sequence,
            occurredAt: requireTimestamp(event.occurredAt, 'Event timestamp'),
            event
          }
          sequence += 1
          eventSequence += 1
          return record
        })
        await appendRecords(missionId, records)
        nextSequences.set(missionId, sequence)
        nextEventSequences.set(missionId, eventSequence)
      })
    },

    appendHostFailure(missionId: string, failure: MissionHostFailure): Promise<void> {
      return serialize(async () => {
        requireSafeId(missionId, 'missionId')
        validateFailure(failure)
        const hydrated = await hydrateForAppend(missionId)
        const record: HostFailureRecord = {
          schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
          recordType: 'mission.host_failure',
          ledgerSequence: hydrated.nextSequence,
          occurredAt: failure.occurredAt,
          failure
        }
        await appendRecords(missionId, [record])
        nextSequences.set(missionId, hydrated.nextSequence + 1)
      })
    },

    createCheckpoint(missionId: string, reason: CheckpointReason): Promise<ReconciledCheckpoint> {
      return serialize(async () => {
        requireSafeId(missionId, 'missionId')
        // Read the FILE first, before hydrating anything. Reconciliation runs
        // against what survived an fsync, never against cached counters -- the
        // cached view is exactly what an interrupted process leaves behind.
        // Reading first also matters for a damaged ledger: `hydrateForAppend`
        // fails closed on integrity issues, so hydrating up front would turn
        // the most important verdict this function can return into an opaque
        // throw, and the caller needs the reason, not just the refusal.
        const parsed = await readLedgerFile(missionPath(rootDirectory, missionId), missionId)
        const mission = parsed.mission
        if (mission === undefined) throw new Error('Mission ledger could not be reconciled')
        const checkpoint = reconcileMission(
          { metadata: mission.metadata, events: mission.events, issues: mission.issues },
          {
            reason,
            epoch: mission.checkpoints.length + 1,
            createdAt: now().toISOString()
          }
        )
        // Same rule as events: the reader defines what is writable.
        if (parsedCheckpoint(checkpoint, mission.metadata) === undefined) {
          throw new Error('Checkpoint is not readable by the ledger reader')
        }
        // An already-broken ledger cannot be checkpointed durably. Recovery
        // stops at the first record it cannot parse, so anything appended past
        // that break is written, fsynced, and permanently unreachable -- the
        // exact shape of the defect this ledger was hardened against. The
        // verdict still goes back to the caller, and `unsafe` is the strongest
        // answer it can give, so nothing is lost by declining to write it.
        if (checkpoint.resumeSafety === 'unsafe') return checkpoint
        const hydrated = await hydrateForAppend(missionId)
        const record: CheckpointRecord = {
          schemaVersion: MISSION_LEDGER_SCHEMA_VERSION,
          recordType: 'mission.checkpoint',
          ledgerSequence: hydrated.nextSequence,
          occurredAt: checkpoint.createdAt,
          checkpoint
        }
        await appendRecords(missionId, [record])
        nextSequences.set(missionId, hydrated.nextSequence + 1)
        return checkpoint
      })
    },

    async getMission(missionId: string): Promise<RecoveredMission | undefined> {
      requireSafeId(missionId, 'missionId')
      await writeTail
      await ensureDirectory()
      const parsed = await readLedgerFile(missionPath(rootDirectory, missionId), missionId)
      return parsed.mission
    },

    async listMissions(options?: MissionLedgerListOptions): Promise<MissionLedgerSnapshot> {
      const limit = options?.limit === undefined
        ? DEFAULT_MISSION_LIST_LIMIT
        : Math.min(Math.max(Math.trunc(options.limit), 1), MAX_MISSION_FILES)
      await writeTail
      await ensureDirectory()
      let entries
      try {
        entries = await readdir(rootDirectory, { withFileTypes: true })
      } catch {
        return {
          missions: [],
          issues: [publicIssue('read-failed', 'Local mission history could not be read.')]
        }
      }
      const candidateIds = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => entry.name.slice(0, -'.jsonl'.length))
        .filter((missionId) => SAFE_ID.test(missionId))
        .sort()
      const issues: MissionLedgerIssue[] = []
      if (candidateIds.length > MAX_MISSION_FILES) {
        issues.push(publicIssue(
          'file-limit-exceeded',
          `Only the first ${MAX_MISSION_FILES} local mission ledgers were inspected.`
        ))
      }
      const parsed = await Promise.all(candidateIds.slice(0, MAX_MISSION_FILES).map(async (missionId) =>
        readLedgerFile(missionPath(rootDirectory, missionId), missionId)))
      const missions = parsed
        .flatMap((result) => result.mission === undefined ? [] : [result.mission])
        .sort((left, right) => Date.parse(right.lastUpdatedAt) - Date.parse(left.lastUpdatedAt))
        .slice(0, limit)
      for (const result of parsed) issues.push(...result.issues)
      return { missions, issues }
    },

    flush(): Promise<void> {
      return writeTail
    }
  }
}

export {
  CHECKPOINT_SCHEMA_VERSION,
  MAX_CHECKPOINT_SUMMARY_LENGTH,
  MAX_UNSETTLED_ACTIONS,
  parsedCheckpoint,
  reconcileMission
} from './checkpoint.js'
export type {
  CheckpointReason,
  CheckpointResumeSafety,
  ReconciledCheckpoint,
  ReconcileMissionInput,
  ReconcileMissionOptions,
  UnsettledAction
} from './checkpoint.js'
