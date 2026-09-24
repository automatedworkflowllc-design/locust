import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/**
 * The workroom: the product-owned channel teammates post to each other on.
 *
 * It is its OWN append-only file, never interleaved into a mission ledger. A
 * mission ledger has one writer; a message from one teammate to another has two
 * missions with a stake in it, and a record two writers could race for is the
 * shape of corruption the ledger was hardened against. Mission ledgers point
 * at messages here by id (`mission.peer` records); the text lives in one place.
 *
 * Every message is attributed and routed to ONE named teammate. There is no
 * broadcast on purpose: ambient "everyone sees everything" burns context and
 * creates authority confusion, and the roadmap's rule is that a teammate's
 * message can inform, never instruct. The channel stores who said what to whom
 * and when; what a reader is allowed to make of it is decided where it is
 * shown, and it is always shown as a claim.
 *
 * Same discipline as the ledger: schema version fixed by the first record,
 * contiguous sequence, fsync per append, byte-offset tamper detection, strict
 * revalidation on read, and a truncated tail tolerated rather than fatal.
 */

export const WORKROOM_SCHEMA_VERSION = 1 as const
export const MAX_WORKROOM_MESSAGE_LENGTH = 1_200
export const MAX_WORKROOM_NAME_LENGTH = 40
const MAX_WORKROOM_BYTES = 16 * 1024 * 1024
const MAX_RECORD_BYTES = 64 * 1024
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
const FILE_NAME = 'workroom.jsonl'
const NO_FOLLOW = process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW
const READ_FLAGS = fsConstants.O_RDONLY | NO_FOLLOW
const APPEND_FLAGS = fsConstants.O_WRONLY | fsConstants.O_APPEND | NO_FOLLOW

export interface WorkroomParty {
  readonly teammateId: string
  readonly name: string
}

export interface WorkroomSender extends WorkroomParty {
  /** The mission whose work produced the message. */
  readonly missionId: string
}

export interface WorkroomMessage {
  readonly messageId: string
  /** Channel sequence: messages and deliveries share one ordering. */
  readonly sequence: number
  readonly from: WorkroomSender
  readonly to: WorkroomParty
  readonly text: string
  readonly postedAt: string
}

/**
 * A message was shown to its recipient: it went into the prompt of the named
 * mission. Recorded in the channel, so "unread" is derived from the file and
 * never from a counter that a crash could leave behind.
 */
export interface WorkroomDelivery {
  readonly messageId: string
  readonly missionId: string
  readonly deliveredAt: string
}

export type WorkroomIssueCode =
  | 'read-failed'
  | 'file-too-large'
  | 'truncated-tail'
  | 'invalid-record'
  | 'unsupported-schema'

export interface WorkroomIssue {
  readonly code: WorkroomIssueCode
  readonly message: string
}

export interface WorkroomSnapshot {
  readonly messages: readonly WorkroomMessage[]
  readonly deliveries: readonly WorkroomDelivery[]
  readonly issues: readonly WorkroomIssue[]
}

export interface WorkroomUnread {
  /**
   * Oldest first, so nothing waits behind newer traffic forever -- after any
   * message the caller asked for by id, which comes first whatever its age.
   */
  readonly messages: readonly WorkroomMessage[]
  /** How many more are waiting beyond `messages`. Never silently dropped. */
  readonly remaining: number
}

export interface Workroom {
  post(input: {
    readonly from: WorkroomSender
    readonly to: WorkroomParty
    readonly text: string
  }): Promise<WorkroomMessage>
  /**
   * `include`: messages the run is being started FOR (A2.12). A run the host
   * started to answer a message was shown the five OLDEST waiting, so behind
   * five older ones -- a `when="later"` note, a message that needed nothing
   * back -- the one it was started for was not in its prompt at all. They
   * come first, still waiting or not at all, and count toward the limit.
   */
  unread(teammateId: string, limit: number, include?: readonly string[]): Promise<WorkroomUnread>
  markDelivered(messageIds: readonly string[], missionId: string): Promise<void>
  read(): Promise<WorkroomSnapshot>
  flush(): Promise<void>
}

export interface FileWorkroomOptions {
  readonly rootDirectory: string
  readonly now?: () => Date
  readonly createId?: () => string
}

interface MessageRecord {
  readonly schemaVersion: typeof WORKROOM_SCHEMA_VERSION
  readonly recordType: 'workroom.message'
  readonly sequence: number
  readonly occurredAt: string
  readonly message: Omit<WorkroomMessage, 'sequence'>
}

interface DeliveryRecord {
  readonly schemaVersion: typeof WORKROOM_SCHEMA_VERSION
  readonly recordType: 'workroom.delivery'
  readonly sequence: number
  readonly occurredAt: string
  readonly delivery: WorkroomDelivery
}

type WorkroomRecord = MessageRecord | DeliveryRecord

interface ParsedWorkroom extends WorkroomSnapshot {
  readonly nextSequence: number
  readonly byteLength: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && !value.includes('\0')
    && Number.isFinite(Date.parse(value))
}

/** A name as the roster allows it: printable, bounded, nothing a terminal would act on. */
export function isWorkroomName(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_WORKROOM_NAME_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)
}

/**
 * Message text is shown to a person and quoted into another agent's prompt.
 * Line breaks and tabs are text; every other control character is refused,
 * not stripped, because a message that was silently rewritten is no longer the
 * message its sender is on record as having posted.
 */
export function isWorkroomText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_WORKROOM_MESSAGE_LENGTH
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}

function parsedParty(value: unknown): WorkroomParty | undefined {
  if (!isObject(value) || !isSafeId(value.teammateId) || !isWorkroomName(value.name)) return undefined
  return { teammateId: value.teammateId, name: value.name }
}

function parsedMessage(value: unknown, sequence: number): WorkroomMessage | undefined {
  if (!isObject(value)) return undefined
  const from = parsedParty(value.from)
  const to = parsedParty(value.to)
  if (
    from === undefined
    || to === undefined
    || !isObject(value.from)
    || !isSafeId(value.from.missionId)
    || !isSafeId(value.messageId)
    || !isWorkroomText(value.text)
    || !isTimestamp(value.postedAt)
    // A teammate cannot message itself. A self-addressed record is either a
    // bug or an edit, and either way it would be delivered to its own author
    // as if a colleague had said it.
    || from.teammateId === to.teammateId
  ) return undefined
  return {
    messageId: value.messageId,
    sequence,
    from: { ...from, missionId: value.from.missionId },
    to,
    text: value.text,
    postedAt: value.postedAt
  }
}

function parsedDelivery(value: unknown): WorkroomDelivery | undefined {
  if (!isObject(value) || !isSafeId(value.messageId) || !isSafeId(value.missionId) || !isTimestamp(value.deliveredAt)) {
    return undefined
  }
  return { messageId: value.messageId, missionId: value.missionId, deliveredAt: value.deliveredAt }
}

function issue(code: WorkroomIssueCode, message: string): WorkroomIssue {
  return { code, message }
}

function recordLine(record: WorkroomRecord): string {
  const line = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
    throw new Error('Workroom record exceeds its safety limit')
  }
  return line
}

async function readWorkroomFile(path: string): Promise<ParsedWorkroom> {
  const empty: ParsedWorkroom = { messages: [], deliveries: [], issues: [], nextSequence: 1, byteLength: 0 }
  let handle: FileHandle
  try {
    handle = await open(path, READ_FLAGS)
  } catch (error) {
    // No file yet is the ordinary state of a workspace where nobody has
    // shared anything. Only a file that exists and cannot be read is an issue.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty
    return { ...empty, issues: [issue('read-failed', 'The workroom could not be read.')] }
  }

  let text: string
  try {
    const file = await handle.stat()
    if (!file.isFile()) return { ...empty, issues: [issue('read-failed', 'The workroom was not a regular file.')] }
    if (file.size > MAX_WORKROOM_BYTES) {
      return { ...empty, issues: [issue('file-too-large', 'The workroom exceeded the local safety limit.')] }
    }
    text = await handle.readFile('utf8')
  } catch {
    return { ...empty, issues: [issue('read-failed', 'The workroom could not be read.')] }
  } finally {
    await handle.close().catch(() => undefined)
  }

  const issues: WorkroomIssue[] = []
  const hasTrailingNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (!hasTrailingNewline && lines.length > 0) {
    lines.pop()
    issues.push(issue('truncated-tail', 'An incomplete final workroom record was ignored.'))
  }

  const messages: WorkroomMessage[] = []
  const deliveries: WorkroomDelivery[] = []
  const seen = new Set<string>()
  const delivered = new Set<string>()
  let expectedSequence = 1
  for (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
      issues.push(issue('invalid-record', 'An oversized workroom record and its tail were ignored.'))
      break
    }
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      issues.push(issue('invalid-record', 'An invalid workroom record and its tail were ignored.'))
      break
    }
    if (!isObject(value)) {
      issues.push(issue('invalid-record', 'An invalid workroom record and its tail were ignored.'))
      break
    }
    if (value.schemaVersion !== WORKROOM_SCHEMA_VERSION) {
      issues.push(issue('unsupported-schema', 'The workroom uses an unsupported schema.'))
      break
    }
    if (value.sequence !== expectedSequence || !isTimestamp(value.occurredAt)) {
      issues.push(issue('invalid-record', 'A noncontiguous workroom record and its tail were ignored.'))
      break
    }
    if (value.recordType === 'workroom.message') {
      const message = parsedMessage(value.message, expectedSequence)
      if (message === undefined || message.postedAt !== value.occurredAt || seen.has(message.messageId)) {
        issues.push(issue('invalid-record', 'An invalid workroom message and its tail were ignored.'))
        break
      }
      seen.add(message.messageId)
      messages.push(message)
    } else if (value.recordType === 'workroom.delivery') {
      const delivery = parsedDelivery(value.delivery)
      // A delivery names a message that must already be in the file, exactly
      // once. Delivering twice would show the recipient the same claim as two.
      if (
        delivery === undefined
        || delivery.deliveredAt !== value.occurredAt
        || !seen.has(delivery.messageId)
        || delivered.has(delivery.messageId)
      ) {
        issues.push(issue('invalid-record', 'An invalid workroom delivery and its tail were ignored.'))
        break
      }
      delivered.add(delivery.messageId)
      deliveries.push(delivery)
    } else {
      issues.push(issue('invalid-record', 'An unknown workroom record and its tail were ignored.'))
      break
    }
    expectedSequence += 1
  }

  return {
    messages,
    deliveries,
    issues,
    nextSequence: expectedSequence,
    byteLength: Buffer.byteLength(text, 'utf8')
  }
}

export function createFileWorkroom(options: FileWorkroomOptions): Workroom {
  const rootDirectory = options.rootDirectory
  if (!isAbsolute(rootDirectory) || rootDirectory.includes('\0')) {
    throw new Error('Workroom directory is invalid')
  }
  const path = join(rootDirectory, FILE_NAME)
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? (() => randomUUID().replace(/-/g, ''))

  let writeTail: Promise<void> = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeTail.then(operation)
    writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Every append re-reads the file first. The channel is small and appends are
   * rare, and reading first is what makes the writer exactly as strict as the
   * reader: an append lands only on a file the reader can walk end to end, at
   * the byte offset the reader measured.
   */
  const appendRecords = async (
    build: (parsed: ParsedWorkroom) => readonly WorkroomRecord[]
  ): Promise<readonly WorkroomRecord[]> => {
    await mkdir(rootDirectory, { recursive: true, mode: 0o700 })
    const parsed = await readWorkroomFile(path)
    if (parsed.issues.length > 0) throw new Error('Workroom is unavailable')
    const records = build(parsed)
    if (records.length === 0) return records
    const lines = records.map(recordLine).join('')
    const appendBytes = Buffer.byteLength(lines, 'utf8')
    if (parsed.byteLength + appendBytes > MAX_WORKROOM_BYTES) {
      throw new Error('Workroom exceeds its safety limit')
    }
    const handle = await open(path, APPEND_FLAGS | fsConstants.O_CREAT, 0o600)
    try {
      const file = await handle.stat()
      if (!file.isFile() || file.size !== parsed.byteLength) {
        throw new Error('Workroom changed outside the active writer')
      }
      await handle.writeFile(lines, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    return records
  }

  return {
    post(input): Promise<WorkroomMessage> {
      return serialize(async () => {
        if (!isSafeId(input.from.teammateId) || !isWorkroomName(input.from.name) || !isSafeId(input.from.missionId)) {
          throw new Error('Workroom sender is invalid')
        }
        if (!isSafeId(input.to.teammateId) || !isWorkroomName(input.to.name)) {
          throw new Error('Workroom recipient is invalid')
        }
        if (input.from.teammateId === input.to.teammateId) {
          throw new Error('A teammate cannot message itself')
        }
        if (!isWorkroomText(input.text)) throw new Error('Workroom message text is invalid')
        const postedAt = now().toISOString()
        const message: Omit<WorkroomMessage, 'sequence'> = {
          messageId: `wm_${createId()}`,
          from: { teammateId: input.from.teammateId, name: input.from.name, missionId: input.from.missionId },
          to: { teammateId: input.to.teammateId, name: input.to.name },
          text: input.text,
          postedAt
        }
        let sequence = 0
        let already: WorkroomMessage | undefined
        await appendRecords((parsed) => {
          /*
           * KEYED DELIVERY (A2.2). The same words, from the same run, to the
           * same teammate, are one message: a re-read of a finished reply, a
           * retry, a restart part-way through posting, or a model that wrote
           * the same block twice must not deliver it twice -- each delivery
           * can start a run. Rakazo and agent-native both key deliveries
           * this way. The second post answers with the first message.
           */
          already = parsed.messages.find(
            (held) => held.from.missionId === message.from.missionId && held.to.teammateId === message.to.teammateId && held.text === message.text
          )
          if (already !== undefined) return []
          sequence = parsed.nextSequence
          // Same rule as the ledger: the reader defines what is writable.
          if (parsedMessage(message, sequence) === undefined) {
            throw new Error('Workroom message is not readable by the workroom reader')
          }
          return [{
            schemaVersion: WORKROOM_SCHEMA_VERSION,
            recordType: 'workroom.message',
            sequence,
            occurredAt: postedAt,
            message
          }]
        })
        return already ?? { ...message, sequence }
      })
    },

    unread(teammateId: string, limit: number, include?: readonly string[]): Promise<WorkroomUnread> {
      return serialize(async () => {
        if (!isSafeId(teammateId)) throw new Error('Teammate id is invalid')
        const bounded = Math.max(0, Math.trunc(limit))
        const parsed = await readWorkroomFile(path)
        if (parsed.issues.length > 0) throw new Error('Workroom is unavailable')
        const delivered = new Set(parsed.deliveries.map((delivery) => delivery.messageId))
        const waiting = parsed.messages.filter(
          (message) => message.to.teammateId === teammateId && !delivered.has(message.messageId)
        )
        // Asked for first -- a run started to answer them must be shown them
        // -- then the oldest of the rest.
        const asked = include === undefined ? [] : waiting.filter((message) => include.includes(message.messageId))
        const chosen = [...asked, ...waiting.filter((message) => !asked.includes(message))].slice(0, Math.max(bounded, asked.length))
        return {
          messages: chosen,
          remaining: Math.max(0, waiting.length - chosen.length)
        }
      })
    },

    markDelivered(messageIds: readonly string[], missionId: string): Promise<void> {
      return serialize(async () => {
        if (!isSafeId(missionId)) throw new Error('Mission id is invalid')
        const unique = [...new Set(messageIds)]
        if (unique.length === 0) return
        if (!unique.every(isSafeId)) throw new Error('Message id is invalid')
        const deliveredAt = now().toISOString()
        await appendRecords((parsed) => {
          const known = new Set(parsed.messages.map((message) => message.messageId))
          const delivered = new Set(parsed.deliveries.map((delivery) => delivery.messageId))
          let sequence = parsed.nextSequence
          return unique.map((messageId) => {
            if (!known.has(messageId)) throw new Error('Unknown workroom message')
            if (delivered.has(messageId)) throw new Error('Workroom message was already delivered')
            const record: DeliveryRecord = {
              schemaVersion: WORKROOM_SCHEMA_VERSION,
              recordType: 'workroom.delivery',
              sequence,
              occurredAt: deliveredAt,
              delivery: { messageId, missionId, deliveredAt }
            }
            sequence += 1
            return record
          })
        })
      })
    },

    async read(): Promise<WorkroomSnapshot> {
      await writeTail
      const parsed = await readWorkroomFile(path)
      return { messages: parsed.messages, deliveries: parsed.deliveries, issues: parsed.issues }
    },

    flush(): Promise<void> {
      return writeTail
    }
  }
}
