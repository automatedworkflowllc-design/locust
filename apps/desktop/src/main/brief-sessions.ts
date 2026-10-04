import { constants as fsConstants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * WHAT EACH CLI SESSION HAS BEEN TOLD (A2.5).
 *
 * A resumed turn is sent only the paragraphs of the standing brief its
 * session does not already hold (workroom-briefing.ts), so the host has to
 * know what it holds. The runtime's own session is the truth and cannot be
 * read back, so this is the host's account of it: per mission, the keys of
 * every brief paragraph that mission's session has been sent, and how many
 * turns ago it was last briefed in full.
 *
 * Every doubt resolves to a full brief, which is what every turn got before
 * this existed: no record, an unreadable file, a cold start, a session that
 * compacted, or FULL_BRIEF_EVERY turns gone by. A turn that is told too much
 * costs characters; one told too little can lose the reply formats, so the
 * record only ever takes paragraphs away when it is sure.
 */

/**
 * A session is briefed in full at least this often, whatever the record says:
 * a runtime that compacts without saying so (Cursor reports nothing) or keeps
 * only the recent turns in view still gets the whole brief back within a few
 * turns.
 */
export const FULL_BRIEF_EVERY = 8

/** Missions remembered; the oldest go first. A forgotten one is briefed in full. */
const MAX_SESSIONS = 500
/** Keys per session; beyond this the ones no brief has stood on longest go first. */
const MAX_KEYS = 400
const MAX_FILE_BYTES = 4 * 1024 * 1024
const KEY = /^[0-9a-f]{16}$/

export interface BriefRecord {
  /** `paragraphKey`s of the brief paragraphs the session holds. */
  readonly given: readonly string[]
  /** Turns since the session was last briefed in full: 0 on that turn. */
  readonly turns: number
}

export interface BriefSessions {
  /** What the session of `missionId` holds; undefined when there is nothing to trust. */
  after(missionId: string): Promise<BriefRecord | undefined>
  /** What the session of `missionId` holds once its turn is sent. */
  record(missionId: string, record: BriefRecord): Promise<void>
}

/**
 * Whether the runtime compacted its conversation during a run: every adapter
 * that can tell raises `<runtime>.context_compacted` (OpenCode's is A6.9).
 * A compacted session keeps a summary, not the brief, so the next turn is
 * briefed in full.
 */
export function compactedDuring(events: readonly NormalizedRuntimeEvent[]): boolean {
  return events.some((event) => event.type === 'adapter.diagnostic' && /\.context_compacted$/.test(event.payload.code))
}

/**
 * What a turn may take as already told, and the turn count it records.
 *
 * `resumes` is whether the turn runs in the earlier turn's CLI session -- a
 * cold start (no session, a changed mode, another runtime) holds nothing.
 */
export function briefPlan(input: {
  readonly resumes: boolean
  readonly compacted: boolean
  readonly earlier: BriefRecord | undefined
}): { readonly alreadyGiven?: ReadonlySet<string>; readonly turns: number } {
  if (!input.resumes || input.compacted || input.earlier === undefined) return { turns: 0 }
  const turns = input.earlier.turns + 1
  if (turns >= FULL_BRIEF_EVERY) return { turns: 0 }
  return { alreadyGiven: new Set(input.earlier.given), turns }
}

/**
 * What the session holds after this turn: what it held, and what this brief
 * stands on, newest last, so the bound drops what no brief has used longest.
 */
export function briefHeld(alreadyGiven: ReadonlySet<string> | undefined, given: readonly string[]): readonly string[] {
  const now = new Set(given)
  const kept = [...(alreadyGiven ?? [])].filter((key) => !now.has(key))
  return [...kept, ...now].slice(-MAX_KEYS)
}

interface StoredSession extends BriefRecord {
  readonly at: string
}

interface StoredFile {
  readonly version: 1
  readonly sessions: Readonly<Record<string, StoredSession>>
}

const EMPTY: StoredFile = { version: 1, sessions: {} }

function parsedFile(text: string): StoredFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return EMPTY
  }
  if (typeof value !== 'object' || value === null) return EMPTY
  const candidate = value as { version?: unknown; sessions?: unknown }
  if (candidate.version !== 1 || typeof candidate.sessions !== 'object' || candidate.sessions === null) return EMPTY
  const sessions: Record<string, StoredSession> = {}
  for (const [missionId, raw] of Object.entries(candidate.sessions as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as { given?: unknown; turns?: unknown; at?: unknown }
    // A record that does not read as one is no record: that session is
    // briefed in full, which is always safe.
    if (!Array.isArray(entry.given) || !entry.given.every((key) => typeof key === 'string' && KEY.test(key))) continue
    if (typeof entry.turns !== 'number' || !Number.isSafeInteger(entry.turns) || entry.turns < 0) continue
    if (typeof entry.at !== 'string') continue
    sessions[missionId] = { given: entry.given as string[], turns: entry.turns, at: entry.at }
  }
  return { version: 1, sessions }
}

export function createBriefSessions(options: {
  readonly rootDirectory: string
  readonly now?: () => Date
}): BriefSessions {
  if (!isAbsolute(options.rootDirectory)) throw new Error('Brief session directory is invalid')
  const path = join(options.rootDirectory, 'brief-sessions.json')
  const now = options.now ?? (() => new Date())

  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  // Unreadable reads as empty here, unlike the stores a person edits: the
  // only cost of forgetting is a full brief, and a turn must never be
  // refused over it.
  const read = async (): Promise<StoredFile> => {
    try {
      const text = await readFile(path, 'utf8')
      return Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES ? EMPTY : parsedFile(text)
    } catch {
      return EMPTY
    }
  }

  const write = async (file: StoredFile): Promise<void> => {
    await mkdir(options.rootDirectory, { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(file)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  return {
    after(missionId) {
      return serialize(async () => {
        const held = (await read()).sessions[missionId]
        return held === undefined ? undefined : { given: held.given, turns: held.turns }
      })
    },
    record(missionId, record) {
      return serialize(async () => {
        const file = await read()
        const sessions = { ...file.sessions }
        delete sessions[missionId]
        sessions[missionId] = { given: [...record.given].slice(-MAX_KEYS), turns: record.turns, at: now().toISOString() }
        // Oldest out first; insertion order is recording order.
        const ids = Object.keys(sessions)
        for (const stale of ids.slice(0, Math.max(0, ids.length - MAX_SESSIONS))) delete sessions[stale]
        await write({ version: 1, sessions })
      })
    }
  }
}
