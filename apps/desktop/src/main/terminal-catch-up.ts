import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { MissionRuntimeId, NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * WHAT HAPPENED IN THE TERMINAL COMES BACK (0.391).
 *
 * Colin, 2026-09-27, reading the `</>` button's words ("Locust won't see what
 * you do there"): "wont we want to be able to keep up on projects our users
 * carry on w/ terminal?" The runtime already kept up -- the terminal resumed
 * Locust's own session -- but Locust's record did not. This reads the
 * session's own transcript for the exchanges a person had in the terminal and
 * records each as a turn of the conversation, marked as such. What was
 * measured, and why each rule holds: docs/PLAN-TERMINAL-CATCH-UP-2026-09-27.md.
 *
 * Only Claude Code and Codex so far: each keeps its session as a JSONL file
 * whose shape was measured. The others keep theirs elsewhere.
 */

export interface TerminalExchange {
  /** What the person typed in the terminal. */
  readonly prompt: string
  /** The runtime's last words in answer, if it gave any. */
  readonly answer: string | undefined
  readonly startedAt: string
  readonly finishedAt: string
  /** The model that answered, when the transcript says. */
  readonly model?: string
  /** How many transcript lines the exchange spans. */
  readonly lines: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(line)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
/**
 * Injected context and command wrappers begin with a tag; a person's words do
 * not. Nor do the lines a runtime writes in the person's place, counted in
 * real session files (2026-09-27): Claude's note when a reply is stopped, and
 * Codex's copy of a folder's AGENTS.md.
 */
const WRITTEN_FOR_THE_PERSON = ['<', '[Request interrupted by user', '# AGENTS.md instructions']
const typedWords = (text: string): string | undefined => {
  const trimmed = text.trim()
  return trimmed.length === 0 || WRITTEN_FOR_THE_PERSON.some((start) => trimmed.startsWith(start)) ? undefined : trimmed
}
/** `/review the diff`, from Claude's `<command-name>` wrapper; undefined when it is not one. */
const commandTyped = (text: string): string | undefined => {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim()
  if (name === undefined || name.length === 0) return undefined
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim() ?? ''
  return args.length === 0 ? name : `${name} ${args}`
}

/**
 * CLAUDE CODE: the exchanges typed in its own terminal, after `after`.
 *
 * A prompt's `entrypoint` says where it was typed: `cli` is the interactive
 * terminal; Locust runs Claude in print mode, `sdk-cli`. So a `cli` prompt in
 * a Locust conversation's session was the person, in the terminal -- and a
 * prompt from anywhere else ends the exchange before it, so an answer to
 * Locust's own turn is never taken for the terminal's.
 *
 * A slash command typed there is an exchange when Claude answered it (a
 * skill, say) and nothing when it did not (`/model`, `/cost`). A compacted
 * session's summary is Claude's, not the person's.
 *
 * An exchange still going when the file ends is held back, so its answer is
 * never brought back half-written: it is over at an answer that did not stop
 * for a tool (`stop_reason` other than `tool_use`), at the turn's closing
 * `turn_duration` line, when the person stopped it, or when anyone's next
 * prompt follows it -- measured over 300 session files, 2026-09-27.
 */
export function claudeTerminalExchanges(text: string, after: string): readonly TerminalExchange[] {
  const exchanges: TerminalExchange[] = []
  let open: { prompt: string; startedAt: string; finishedAt: string; answer?: string; model?: string; lines: number; command: boolean; over: boolean } | undefined
  const close = (): void => {
    if (open !== undefined && open.over && !(open.command && open.answer === undefined)) {
      exchanges.push({ prompt: open.prompt, answer: open.answer, startedAt: open.startedAt, finishedAt: open.finishedAt, ...(open.model === undefined ? {} : { model: open.model }), lines: open.lines })
    }
    open = undefined
  }
  for (const line of text.split('\n')) {
    const entry = parse(line)
    if (entry === undefined || entry.isSidechain === true) continue
    const at = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    if (at === undefined) continue
    const message = isRecord(entry.message) ? entry.message : {}
    if (entry.type === 'user') {
      const content = message.content
      const said =
        typeof content === 'string'
          ? content
          : Array.isArray(content) && !content.some((block) => isRecord(block) && block.type === 'tool_result')
            ? content.flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n')
            : undefined
      if (said === undefined) {
        if (open !== undefined) open.lines += 1
        continue
      }
      if (said.trim().startsWith('[Request interrupted by user')) {
        if (open !== undefined) open.over = true
        continue
      }
      if (entry.isMeta === true || entry.promptSource === 'system' || entry.isCompactSummary === true || entry.isVisibleInTranscriptOnly === true) continue
      const command = commandTyped(said)
      const words = command ?? typedWords(said)
      if (words === undefined) continue
      // A prompt: whoever typed it, the exchange before it is over.
      if (open !== undefined) open.over = true
      close()
      if (entry.entrypoint === 'cli' && at > after) open = { prompt: words, startedAt: at, finishedAt: at, lines: 1, command: command !== undefined, over: false }
      continue
    }
    if (entry.type === 'system' && entry.subtype === 'turn_duration' && open !== undefined) {
      open.over = true
      continue
    }
    if (entry.type === 'assistant' && open !== undefined) {
      open.lines += 1
      open.finishedAt = at
      const content = Array.isArray(message.content) ? message.content : []
      const words = content.flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])).join('\n').trim()
      if (words.length > 0) open.answer = words
      if (typeof message.model === 'string') open.model = message.model
      if (typeof message.stop_reason === 'string') open.over = message.stop_reason !== 'tool_use'
    }
  }
  close()
  return exchanges
}

/**
 * CODEX: the turns in a rollout after `after`.
 *
 * A rollout says nothing about which client wrote a turn, so it is TIME that
 * separates the terminal's turns from Locust's: this runs only before Locust
 * starts another turn on the conversation and never while one runs, so a turn
 * newer than the conversation's last recorded one happened elsewhere. A typed
 * prompt is a `user` message whose text does not begin with a tag; the answer
 * is the turn's last `assistant` message. A turn still going when the file
 * ends -- no `task_complete` yet, as 36 of 400 rollouts ended -- is held back.
 */
export function codexTerminalExchanges(text: string, after: string): readonly TerminalExchange[] {
  const exchanges: TerminalExchange[] = []
  let open: { prompt: string; startedAt: string; finishedAt: string; answer?: string; model?: string; lines: number; over: boolean } | undefined
  let model: string | undefined
  const close = (): void => {
    if (open?.over === true) exchanges.push({ prompt: open.prompt, answer: open.answer, startedAt: open.startedAt, finishedAt: open.finishedAt, ...(open.model === undefined ? {} : { model: open.model }), lines: open.lines })
    open = undefined
  }
  for (const line of text.split('\n')) {
    const entry = parse(line)
    if (entry === undefined) continue
    const at = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    if (at === undefined || at <= after) continue
    const payload = isRecord(entry.payload) ? entry.payload : {}
    if (entry.type === 'turn_context' && typeof payload.model === 'string') model = payload.model
    if (entry.type === 'event_msg' && (payload.type === 'task_complete' || payload.type === 'turn_aborted') && open !== undefined) open.over = true
    if (entry.type !== 'response_item' || payload.type !== 'message') {
      if (open !== undefined) open.lines += 1
      continue
    }
    const words = (Array.isArray(payload.content) ? payload.content : [])
      .flatMap((block) => (isRecord(block) && typeof block.text === 'string' ? [block.text] : []))
      .join('\n')
    if (payload.role === 'user') {
      const typed = typedWords(words)
      if (typed === undefined) continue
      // A prompt: the turn before it is over, whatever its file said.
      if (open !== undefined) open.over = true
      close()
      open = { prompt: typed, startedAt: at, finishedAt: at, lines: 1, over: false, ...(model === undefined ? {} : { model }) }
      continue
    }
    if (payload.role === 'assistant' && open !== undefined) {
      open.lines += 1
      open.finishedAt = at
      if (words.trim().length > 0) open.answer = words.trim()
    }
  }
  close()
  return exchanges
}

/** Where a session's transcript is kept, for the runtimes this reads. */
export async function transcriptPathFor(
  runtime: MissionRuntimeId,
  sessionId: string,
  places: { readonly claudeHome: string; readonly codexHome: string }
): Promise<string | undefined> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(sessionId)) return undefined
  if (runtime === 'claude') {
    // `projects/<the folder, slugged>/<session>.jsonl`: found by the session's
    // own name, so the slug rule never has to be copied.
    const projects = join(places.claudeHome, 'projects')
    for (const folder of await readdir(projects).catch(() => [] as string[])) {
      const candidate = join(projects, folder, `${sessionId}.jsonl`)
      if (await stat(candidate).then((found) => found.isFile(), () => false)) return candidate
    }
    return undefined
  }
  if (runtime === 'codex') {
    // `sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl`, newest days first.
    const sessions = join(places.codexHome, 'sessions')
    const newestFirst = async (at: string): Promise<string[]> => (await readdir(at).catch(() => [] as string[])).sort().reverse()
    for (const year of await newestFirst(sessions)) {
      for (const month of await newestFirst(join(sessions, year))) {
        for (const day of await newestFirst(join(sessions, year, month))) {
          const found = (await readdir(join(sessions, year, month, day)).catch(() => [] as string[])).find((name) => name.endsWith(`-${sessionId}.jsonl`))
          if (found !== undefined) return join(sessions, year, month, day, found)
        }
      }
    }
    return undefined
  }
  return undefined
}

/**
 * A session's transcript, read only when it changed since it was last read.
 * The window asks on every focus, and a long session's file runs to tens of
 * megabytes; unchanged, it holds nothing new.
 */
export function createTranscriptReader(places: { readonly claudeHome: string; readonly codexHome: string }): CatchUpFacts['transcriptOf'] {
  const paths = new Map<string, string>()
  const stamps = new Map<string, string>()
  return async (runtime, sessionId) => {
    const key = `${runtime}:${sessionId}`
    const path = paths.get(key) ?? (await transcriptPathFor(runtime, sessionId, places))
    if (path === undefined) return undefined
    const found = await stat(path).catch(() => undefined)
    if (found === undefined) {
      paths.delete(key)
      return undefined
    }
    paths.set(key, path)
    const stamp = `${String(found.mtimeMs)}:${String(found.size)}`
    if (stamps.get(path) === stamp) return undefined
    const text = await readFile(path, 'utf8')
    stamps.set(path, stamp)
    return text
  }
}

/**
 * How far each session's transcript has been brought back. The conversation
 * itself says where it ends; this is for the exchange a person brought back
 * and then deleted, which must stay deleted.
 */
export interface TerminalImports {
  /** The time the session was read through, if it ever was. */
  read(sessionId: string): Promise<string | undefined>
  write(sessionId: string, through: string): Promise<void>
}

export function createTerminalImports(file: string): TerminalImports {
  const load = async (): Promise<Record<string, { through?: unknown }>> => {
    const text = await readFile(file, 'utf8').catch(() => '{}')
    try {
      const parsed: unknown = JSON.parse(text)
      return isRecord(parsed) ? (parsed as Record<string, { through?: unknown }>) : {}
    } catch {
      return {}
    }
  }
  return {
    async read(sessionId) {
      const through = (await load())[sessionId]?.through
      return typeof through === 'string' ? through : undefined
    },
    async write(sessionId, through) {
      const all = await load()
      all[sessionId] = { through }
      await mkdir(dirname(file), { recursive: true })
      // Whole or not at all: a torn file would read as nothing brought back.
      const partial = `${file}.${String(process.pid)}.tmp`
      await writeFile(partial, JSON.stringify(all), 'utf8')
      await rename(partial, file)
    }
  }
}

export interface CatchUpFacts {
  readonly ledger: Pick<MissionLedger, 'getMission' | 'createMission' | 'appendEvents'>
  readonly liveMissionIds: () => readonly string[]
  /** The session a mission's turn ran on (codex-mission's runtimeThreadIdOf). */
  readonly sessionOf: (mission: NonNullable<Awaited<ReturnType<MissionLedger['getMission']>>>) => string | undefined
  readonly transcriptOf: (runtime: MissionRuntimeId, sessionId: string) => Promise<string | undefined>
  readonly imports: TerminalImports
  readonly ownerOf: (missionId: string) => Promise<string | undefined>
  readonly assign: (teammateId: string, missionId: string) => Promise<void>
  /**
   * The conversation's newest turn, from any of its turns (mission-history's
   * newestTurnOf). A window can name an older turn than the newest, and only
   * what came after the newest can be the terminal's: a Codex rollout does
   * not say which client wrote a turn, so reading after an older one would
   * take Locust's own later turn for the terminal's.
   */
  readonly newestTurnOf: (missionId: string) => Promise<string>
  readonly createId?: () => string
}

export interface CatchUpResult {
  /** How many terminal exchanges were recorded now. */
  readonly imported: number
  /**
   * The turn a follow-up continues from: the terminal's last turn when the
   * conversation ends in one, or else the turn that was named.
   */
  readonly latestMissionId: string
  /**
   * Whose the recorded turns are now: the conversation's teammate. The window
   * decides a message is a REPLY by who owns the turn on screen, so it has to
   * hear this -- the first drive's reply after two terminal turns started a
   * new conversation because the window still thought them nobody's.
   */
  readonly owners?: Readonly<Record<string, string>>
}

// The ledger's own bound on a mission's prompt (mission-store MAX_PROMPT_LENGTH), as session-import.ts has it:
// at 16,000 one long typed prompt was refused there, and every catch-up after it stopped at it (2026-10-10 sweep).
const MAX_PROMPT = 8_000
const MAX_ANSWER = 16_000
const bounded = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/**
 * Bring a conversation's terminal exchanges into the record, after its newest
 * turn -- found from `missionId`, any turn of it. Never while a run is going
 * on it.
 */
export async function catchUpTerminal(missionId: string, facts: CatchUpFacts): Promise<CatchUpResult> {
  const unchanged = { imported: 0, latestMissionId: missionId }
  const newest = await facts.newestTurnOf(missionId).catch(() => missionId)
  // A running turn is its conversation's newest: nothing continues one.
  if (facts.liveMissionIds().includes(newest)) return unchanged
  const mission = await facts.ledger.getMission(newest).catch(() => undefined)
  if (mission === undefined) return unchanged
  const runtime = mission.metadata.runtime
  if (runtime !== 'claude' && runtime !== 'codex') return unchanged
  const session = facts.sessionOf(mission)
  if (session === undefined) return unchanged
  // After the newest thing recorded: the newest turn's end, or how far an
  // earlier catch-up read -- whichever is later.
  const ownEnd = mission.events.at(-1)?.occurredAt ?? mission.metadata.createdAt
  const through = await facts.imports.read(session)
  const after = through !== undefined && through > ownEnd ? through : ownEnd
  let previous = newest
  // With nothing new, a follow-up continues from the terminal's last turn if
  // the conversation ends in one, and otherwise from the turn it named.
  const settled = { imported: 0, latestMissionId: mission.metadata.startedBy?.kind === 'terminal' ? newest : missionId }
  const text = await facts.transcriptOf(runtime, session).catch(() => undefined)
  if (text === undefined) return settled
  const exchanges = runtime === 'claude' ? claudeTerminalExchanges(text, after) : codexTerminalExchanges(text, after)
  if (exchanges.length === 0) return settled
  const owner = await facts.ownerOf(missionId).catch(() => undefined)
  const createId = facts.createId ?? randomUUID
  const owners: Record<string, string> = {}
  let count = 0
  for (const exchange of exchanges) {
    count += 1
    const newMission = `mission_${createId()}`
    const runId = `run_${createId()}`
    const metadata: MissionLedgerMetadata = {
      missionId: newMission,
      runId,
      prompt: bounded(exchange.prompt, MAX_PROMPT),
      runtime,
      model: mission.metadata.model,
      requestedRouteId: mission.metadata.requestedRouteId,
      resolvedRouteId: mission.metadata.resolvedRouteId,
      cliVersion: mission.metadata.cliVersion,
      workspaceId: mission.metadata.workspaceId,
      // What the terminal was allowed is the runtime's own business; the
      // conversation's is the nearest honest word the record has, and
      // `startedBy` says Locust did not run it. No `mode`, no `command`.
      sandbox: mission.metadata.sandbox,
      executionPolicyVersion: 1,
      createdAt: exchange.startedAt,
      continuesFrom: { missionId: previous, checkpointEpoch: 1, reason: 'follow-up', runtimeThreadId: session },
      startedBy: { kind: 'terminal', exchange: count }
    } as MissionLedgerMetadata
    await facts.ledger.createMission(metadata)
    const base = { runId, missionId: newMission, sourceAdapter: runtime, runtimeThreadId: session }
    const evidence = { redacted: true, runtimeEventType: 'terminal.transcript' }
    const events = [
      { ...base, id: `${runId}:1`, sequence: 1, occurredAt: exchange.startedAt, type: 'run.started', payload: { runtimeThreadId: session, evidence } },
      ...(exchange.answer === undefined
        ? []
        : [{ ...base, id: `${runId}:2`, sequence: 2, occurredAt: exchange.finishedAt, type: 'message.delta', payload: { itemId: 'terminal_answer', operation: 'replace', text: bounded(exchange.answer, MAX_ANSWER), final: true, evidence } }]),
      {
        ...base,
        id: `${runId}:${exchange.answer === undefined ? '2' : '3'}`,
        sequence: exchange.answer === undefined ? 2 : 3,
        occurredAt: exchange.finishedAt,
        type: 'run.completed',
        payload: {
          runtimeThreadId: session,
          ...(exchange.model === undefined ? {} : { resolvedModel: exchange.model }),
          // No process of Locust's ran this turn: no exit code, as an
          // Antigravity run records it, and the transcript's own times.
          process: {
            exitCode: null,
            signal: null,
            stderr: '',
            stderrTruncated: false,
            recordCount: exchange.lines,
            inputDeliveryFailed: false,
            outputLimitExceeded: false,
            oversizedRecordsDropped: 0,
            forcedTerminationAttempted: false,
            terminationUnconfirmed: false,
            startedAt: exchange.startedAt,
            finishedAt: exchange.finishedAt
          }
        }
      }
    ] as unknown as readonly NormalizedRuntimeEvent[]
    await facts.ledger.appendEvents(newMission, events)
    if (owner !== undefined) {
      await facts.assign(owner, newMission).catch(() => undefined)
      owners[newMission] = owner
    }
    await facts.imports.write(session, exchange.finishedAt)
    previous = newMission
  }
  return { imported: count, latestMissionId: previous, ...(Object.keys(owners).length === 0 ? {} : { owners }) }
}

/**
 * One catch-up at a time. The window asks when it shows a conversation and
 * when it comes back into focus, and a follow-up asks as it starts: two at
 * once would each read the same exchanges and record them twice.
 */
export function createTerminalCatchUp(facts: CatchUpFacts): (missionId: string) => Promise<CatchUpResult> {
  let queue: Promise<unknown> = Promise.resolve()
  return (missionId) => {
    const next = queue.then(() => catchUpTerminal(missionId, facts))
    queue = next.catch(() => undefined)
    return next
  }
}
