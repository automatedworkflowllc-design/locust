import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { claudeTerminalExchanges, codexTerminalExchanges } from './terminal-catch-up.js'
import type { TerminalExchange, TerminalImports } from './terminal-catch-up.js'

/**
 * IMPORT A CONVERSATION FROM CLAUDE CODE OR CODEX (Colin, 2026-09-29: "look
 * into how claude code and codex allow you to import conversations and see if
 * we can implement that").
 *
 * Both keep every session as a JSONL file on this machine -- Claude Code under
 * ~/.claude/projects, Codex under ~/.codex/sessions -- and both resume one by
 * its id (`claude --resume`, `codex resume`). Codex itself imports Claude
 * sessions this way. So: list the sessions a PERSON had (not Locust's own, not
 * a subagent's, not a script's), and bring the chosen one in as a Locust
 * conversation -- its exchanges as turns, each carrying the session's id, so
 * the next message resumes that same session in its own folder.
 *
 * Nothing is read whole to LIST: a session file runs to a gigabyte (this very
 * machine has one), so a listing reads a file's head and tail. An IMPORT reads
 * the chosen file line by line and keeps only the words of each exchange.
 */

export type ImportRuntime = 'claude' | 'codex'

export interface ImportableSession {
  readonly runtime: ImportRuntime
  readonly sessionId: string
  readonly title: string
  /** The folder the session worked in. */
  readonly cwd: string
  readonly updatedAt: string
  readonly bytes: number
  /** Written to in the last two minutes: probably still open in a terminal. */
  readonly openNow: boolean
}

export interface SessionPlaces {
  readonly claudeHome: string
  readonly codexHome: string
}

const HEAD_BYTES = 64 * 1024
const TAIL_BYTES = 256 * 1024
const OPEN_NOW_MS = 2 * 60_000
const MAX_TITLE = 90
/** The ledger's own bound on a prompt (mission-store MAX_PROMPT_LENGTH). */
const MAX_PROMPT = 8_000
const MAX_ANSWER = 16_000
/** The newest exchanges kept, when a session is longer. */
export const MAX_IMPORTED_EXCHANGES = 200

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(line)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
const oneLine = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= MAX_TITLE ? flat : `${flat.slice(0, MAX_TITLE - 1).trimEnd()}…`
}
const bounded = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

async function readSlice(path: string, from: number, length: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, from)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Whole lines only: a slice cut mid-record parses as nothing, never as half a record. */
const linesOf = (text: string, dropFirst: boolean): readonly Record<string, unknown>[] => {
  const lines = text.split('\n')
  if (dropFirst) lines.shift()
  lines.pop()
  return lines.flatMap((line) => {
    const entry = parse(line)
    return entry === undefined ? [] : [entry]
  })
}

/** What a person typed, from a Claude `user` record; undefined for anything else. */
function claudeTyped(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'user' || entry.isSidechain === true || entry.isMeta === true || entry.isCompactSummary === true) return undefined
  const message = isRecord(entry.message) ? entry.message : {}
  const content = message.content
  const said = typeof content === 'string'
    ? content
    : Array.isArray(content) && !content.some((block) => isRecord(block) && block.type === 'tool_result')
      ? content.flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')
      : undefined
  const trimmed = said?.trim()
  if (trimmed === undefined || trimmed.length === 0 || trimmed.startsWith('<') || trimmed.startsWith('[Request interrupted')) return undefined
  return trimmed
}

async function claudeSession(path: string, bytes: number, mtimeMs: number, now: number): Promise<ImportableSession | undefined> {
  const head = linesOf(await readSlice(path, 0, Math.min(bytes, HEAD_BYTES)), false)
  const tail = bytes <= HEAD_BYTES ? head : linesOf(await readSlice(path, Math.max(0, bytes - TAIL_BYTES), Math.min(bytes, TAIL_BYTES)), true)
  const seen = [...head, ...tail]
  // A person's session: typed in the terminal (`cli`) or Claude's own app
  // (`claude-desktop`). Locust's own runs are `sdk-cli`; a subagent's file
  // opens on a sidechain. A resumed session can open on tool results alone,
  // so its head and its tail are both looked at (measured on this machine).
  if (head.some((entry) => entry.isSidechain === true && entry.type === 'user')) return undefined
  const byPerson = seen.find((entry) => typeof entry.entrypoint === 'string' && entry.entrypoint !== 'sdk-cli' && typeof entry.sessionId === 'string' && typeof entry.cwd === 'string')
  if (byPerson === undefined) return undefined
  const sessionId = byPerson.sessionId as string
  const cwd = byPerson.cwd as string
  let title: string | undefined
  for (const entry of seen) {
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') title = entry.customTitle
    else if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && title === undefined) title = entry.aiTitle
  }
  const typed = head.map(claudeTyped).find((words) => words !== undefined) ?? [...tail].reverse().map(claudeTyped).find((words) => words !== undefined)
  if (title === undefined && typed === undefined) return undefined
  return {
    runtime: 'claude',
    sessionId,
    title: oneLine(title ?? typed ?? 'A Claude Code session'),
    cwd,
    updatedAt: new Date(mtimeMs).toISOString(),
    bytes,
    openNow: now - mtimeMs < OPEN_NOW_MS
  }
}

async function codexSession(path: string, bytes: number, mtimeMs: number, now: number, names: ReadonlyMap<string, string>): Promise<ImportableSession | undefined> {
  const head = linesOf(await readSlice(path, 0, Math.min(bytes, HEAD_BYTES)), false)
  const meta = head.find((entry) => entry.type === 'session_meta')
  const payload = isRecord(meta?.payload) ? meta.payload : undefined
  if (payload === undefined) return undefined
  const sessionId = typeof payload.id === 'string' ? payload.id : undefined
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined
  if (sessionId === undefined || cwd === undefined) return undefined
  // A person's session: not Locust's, not `codex exec`'s, not a subagent's.
  const originator = String(payload.originator ?? '')
  const source = JSON.stringify(payload.source ?? '')
  if (/^locust/i.test(originator) || /exec/i.test(originator) || /exec|subagent/i.test(source)) return undefined
  const firstPrompt = head
    .filter((entry) => entry.type === 'response_item' && isRecord(entry.payload) && entry.payload.type === 'message' && entry.payload.role === 'user')
    .map((entry) => ((isRecord(entry.payload) && Array.isArray(entry.payload.content) ? entry.payload.content : []) as unknown[])
      .flatMap((block) => (isRecord(block) && typeof block.text === 'string' ? [block.text] : [])).join('\n').trim())
    .find((text) => text.length > 0 && !text.startsWith('<') && !text.startsWith('# AGENTS.md'))
  if (firstPrompt === undefined && !names.has(sessionId)) return undefined
  return {
    runtime: 'codex',
    sessionId,
    title: oneLine(names.get(sessionId) ?? firstPrompt ?? 'A Codex session'),
    cwd,
    updatedAt: new Date(mtimeMs).toISOString(),
    bytes,
    openNow: now - mtimeMs < OPEN_NOW_MS
  }
}

/** Codex's own titles for its sessions (`session_index.jsonl`: id, thread_name). */
async function codexNames(codexHome: string): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>()
  const text = await readFile(join(codexHome, 'session_index.jsonl'), 'utf8').catch(() => '')
  for (const line of text.split('\n')) {
    const entry = parse(line)
    if (entry !== undefined && typeof entry.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim().length > 0) names.set(entry.id, entry.thread_name)
  }
  return names
}

/**
 * The sessions a person could bring in, newest first, from the last `days`.
 * `skip` names sessions Locust already holds (its own runs, and any it has
 * read through already).
 */
export async function listImportableSessions(
  places: SessionPlaces,
  options: { readonly now?: Date; readonly days?: number; readonly skip?: ReadonlySet<string> } = {}
): Promise<readonly ImportableSession[]> {
  const now = (options.now ?? new Date()).getTime()
  const since = now - (options.days ?? 30) * 86_400_000
  const skip = options.skip ?? new Set<string>()
  const found: ImportableSession[] = []

  const projects = join(places.claudeHome, 'projects')
  for (const folder of await readdir(projects).catch(() => [] as string[])) {
    for (const name of await readdir(join(projects, folder)).catch(() => [] as string[])) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(projects, folder, name)
      const facts = await stat(path).catch(() => undefined)
      if (facts === undefined || !facts.isFile() || facts.size === 0 || facts.mtimeMs < since) continue
      const session = await claudeSession(path, facts.size, facts.mtimeMs, now).catch(() => undefined)
      if (session !== undefined && !skip.has(session.sessionId)) found.push(session)
    }
  }

  const names = await codexNames(places.codexHome)
  const sessions = join(places.codexHome, 'sessions')
  for (const year of await readdir(sessions).catch(() => [] as string[])) {
    for (const month of await readdir(join(sessions, year)).catch(() => [] as string[])) {
      for (const day of await readdir(join(sessions, year, month)).catch(() => [] as string[])) {
        // A day folder older than the window cannot hold a newer session.
        const dayStart = Date.UTC(Number(year), Number(month) - 1, Number(day))
        if (Number.isFinite(dayStart) && dayStart + 86_400_000 * 2 < since) continue
        for (const name of await readdir(join(sessions, year, month, day)).catch(() => [] as string[])) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          const path = join(sessions, year, month, day, name)
          const facts = await stat(path).catch(() => undefined)
          if (facts === undefined || !facts.isFile() || facts.size === 0 || facts.mtimeMs < since) continue
          const session = await codexSession(path, facts.size, facts.mtimeMs, now, names).catch(() => undefined)
          if (session !== undefined && !skip.has(session.sessionId)) found.push(session)
        }
      }
    }
  }
  // Only where it can go on: a session whose folder is gone could be read,
  // never continued, and the list is of conversations to carry on.
  const kept: ImportableSession[] = []
  for (const session of found) {
    if (await stat(session.cwd).then((folder) => folder.isDirectory(), () => false)) kept.push(session)
  }
  return kept.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/**
 * A session's exchanges, read line by line. Each record is cut down to what
 * the exchange readers use -- who spoke, when, and the words -- so a gigabyte
 * of tool output never sits in memory at once.
 */
export async function sessionExchanges(runtime: ImportRuntime, path: string): Promise<readonly TerminalExchange[]> {
  const kept: string[] = []
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.length === 0) continue
    const entry = parse(line)
    if (entry === undefined) continue
    const slim = runtime === 'claude' ? slimClaude(entry) : slimCodex(entry)
    if (slim !== undefined) kept.push(JSON.stringify(slim))
  }
  const text = kept.join('\n')
  return runtime === 'claude' ? claudeTerminalExchanges(text, '') : codexTerminalExchanges(text, '')
}

const textBlocks = (content: unknown): { type: string; text: string }[] =>
  (Array.isArray(content) ? content : []).flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [{ type: 'text', text: bounded(block.text, MAX_ANSWER) }] : []))

function slimClaude(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const message = isRecord(entry.message) ? entry.message : {}
  const base = { type: entry.type, timestamp: entry.timestamp, isSidechain: entry.isSidechain }
  if (entry.type === 'user') {
    const content = message.content
    const hasResult = Array.isArray(content) && content.some((block) => isRecord(block) && block.type === 'tool_result')
    return {
      ...base,
      // Every prompt a person typed counts here, wherever it was typed.
      entrypoint: 'cli',
      isMeta: entry.isMeta,
      promptSource: entry.promptSource,
      isCompactSummary: entry.isCompactSummary,
      isVisibleInTranscriptOnly: entry.isVisibleInTranscriptOnly,
      message: { content: typeof content === 'string' ? bounded(content, MAX_PROMPT * 2) : hasResult ? [{ type: 'tool_result' }] : textBlocks(content) }
    }
  }
  if (entry.type === 'assistant') {
    return { ...base, message: { model: message.model, stop_reason: message.stop_reason, content: textBlocks(message.content) } }
  }
  if (entry.type === 'system' && entry.subtype === 'turn_duration') return { ...base, subtype: 'turn_duration' }
  return undefined
}

function slimCodex(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const payload = isRecord(entry.payload) ? entry.payload : {}
  if (entry.type === 'turn_context') return { type: entry.type, timestamp: entry.timestamp, payload: { model: payload.model } }
  if (entry.type === 'event_msg' && (payload.type === 'task_complete' || payload.type === 'turn_aborted')) return { type: entry.type, timestamp: entry.timestamp, payload: { type: payload.type } }
  if (entry.type === 'response_item' && payload.type === 'message') {
    const content = (Array.isArray(payload.content) ? payload.content : []).flatMap((block) => (isRecord(block) && typeof block.text === 'string' ? [{ text: bounded(block.text, MAX_ANSWER) }] : []))
    return { type: entry.type, timestamp: entry.timestamp, payload: { type: 'message', role: payload.role, content } }
  }
  return undefined
}

export interface ImportFacts {
  readonly ledger: Pick<MissionLedger, 'createMission' | 'appendEvents'>
  readonly imports: TerminalImports
  readonly workspaceIdFor: (cwd: string) => string
  readonly learnFolder: (id: string, path: string) => Promise<void>
  readonly nameConversation: (missionId: string, title: string) => Promise<void>
  readonly pathOf: (runtime: ImportRuntime, sessionId: string) => Promise<string | undefined>
  readonly createId?: () => string
}

export type ImportResult =
  | { readonly ok: true; readonly missionId: string; readonly turns: number; readonly skipped: number }
  | { readonly ok: false; readonly message: string }

/**
 * Bring one session in: its exchanges as the turns of a new conversation, the
 * newest `MAX_IMPORTED_EXCHANGES` of them, each carrying the session's id so a
 * reply resumes it. The session is then marked read through, so what is done
 * in its terminal later comes back as it does for any Locust conversation.
 */
export async function importSession(session: Pick<ImportableSession, 'runtime' | 'sessionId' | 'cwd' | 'title'>, facts: ImportFacts): Promise<ImportResult> {
  if ((await facts.imports.read(session.sessionId)) !== undefined) {
    return { ok: false, message: 'That conversation is already in Locust.' }
  }
  const path = await facts.pathOf(session.runtime, session.sessionId)
  if (path === undefined) return { ok: false, message: 'Its file could not be found. It may have been deleted or moved.' }
  const all = await sessionExchanges(session.runtime, path).catch(() => undefined)
  if (all === undefined) return { ok: false, message: 'Its file could not be read.' }
  if (all.length === 0) return { ok: false, message: 'It has no finished exchange to bring in yet.' }
  const exchanges = all.slice(-MAX_IMPORTED_EXCHANGES)
  const createId = facts.createId ?? randomUUID
  const workspaceId = facts.workspaceIdFor(session.cwd)
  await facts.learnFolder(workspaceId, session.cwd).catch(() => undefined)
  const runtime = session.runtime
  const route = runtime === 'claude'
    ? { model: 'account-default', requestedRouteId: 'claude', resolvedRouteId: 'claude-account:default' }
    : { model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default' }
  let previous: string | undefined
  let first: string | undefined
  let count = 0
  for (const exchange of exchanges) {
    count += 1
    const missionId = `mission_${createId()}`
    const runId = `run_${createId()}`
    const metadata = {
      missionId,
      runId,
      prompt: bounded(exchange.prompt, MAX_PROMPT),
      runtime,
      ...route,
      cliVersion: null,
      workspaceId,
      sandbox: 'workspace-write',
      executionPolicyVersion: 1,
      createdAt: exchange.startedAt,
      ...(previous === undefined ? {} : { continuesFrom: { missionId: previous, checkpointEpoch: 1, reason: 'follow-up', runtimeThreadId: session.sessionId } }),
      // Typed in the runtime's own terminal or app, not run by Locust.
      startedBy: { kind: 'terminal', exchange: count }
    } as unknown as MissionLedgerMetadata
    await facts.ledger.createMission(metadata)
    const base = { runId, missionId, sourceAdapter: runtime, runtimeThreadId: session.sessionId }
    const evidence = { redacted: true, runtimeEventType: 'import.transcript' }
    const events = [
      { ...base, id: `${runId}:1`, sequence: 1, occurredAt: exchange.startedAt, type: 'run.started', payload: { runtimeThreadId: session.sessionId, evidence } },
      ...(exchange.answer === undefined
        ? []
        : [{ ...base, id: `${runId}:2`, sequence: 2, occurredAt: exchange.finishedAt, type: 'message.delta', payload: { itemId: 'imported_answer', operation: 'replace', text: bounded(exchange.answer, MAX_ANSWER), final: true, evidence } }]),
      {
        ...base,
        id: `${runId}:${exchange.answer === undefined ? '2' : '3'}`,
        sequence: exchange.answer === undefined ? 2 : 3,
        occurredAt: exchange.finishedAt,
        type: 'run.completed',
        payload: {
          runtimeThreadId: session.sessionId,
          ...(exchange.model === undefined ? {} : { resolvedModel: exchange.model }),
          process: { exitCode: null, signal: null, stderr: '', stderrTruncated: false, recordCount: exchange.lines, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: exchange.startedAt, finishedAt: exchange.finishedAt }
        }
      }
    ] as unknown as readonly NormalizedRuntimeEvent[]
    await facts.ledger.appendEvents(missionId, events)
    first ??= missionId
    previous = missionId
  }
  await facts.imports.write(session.sessionId, exchanges.at(-1)!.finishedAt)
  if (first !== undefined) await facts.nameConversation(first, session.title).catch(() => undefined)
  return { ok: true, missionId: previous!, turns: count, skipped: all.length - exchanges.length }
}
