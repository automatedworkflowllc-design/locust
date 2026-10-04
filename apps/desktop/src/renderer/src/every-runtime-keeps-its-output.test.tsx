import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ACP_DECLINED,
  ACP_PROMPT_RESULT,
  ACP_SESSION,
  createAcpEventNormalizer,
  asProcessNormalizer,
  createAgyEventNormalizer,
  createAppServerEventNormalizer,
  createAntigravityEventNormalizer,
  createClaudeEventNormalizer,
  createCopilotEventNormalizer,
  createCursorEventNormalizer,
  createMuseEventNormalizer,
  createOpenCodeEventNormalizer,
  runRecordFor
} from '@teammate/runtime-adapters'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { ThreadItems } from './components/Thread.js'
import { buildThread } from './missionView.js'
import type { ThreadItem } from './missionView.js'

/**
 * EVERY RUNTIME KEEPS ITS OUTPUT WHEN THE LOOK CHANGES (0.571).
 *
 * Colin, 2026-10-03: "every time we change our output style to be more like
 * claudes ... how the harness will map onto the other models, do you have a
 * way to test to make sure that its coming up clean and were not sacrificing
 * any outputs for the other models?" The thread is drawn to Claude Code's
 * shape; seven other runtimes feed it. Each has real runs recorded beside
 * its adapter, and until now only three renderer tests pushed any of them
 * through `buildThread`.
 *
 * Here EVERY recording is replayed through its real normalizer, the thread
 * is built as the window builds it -- finished, and at points while it runs
 * -- and drawn. Whatever the look becomes, for every runtime:
 *   - every message the runtime finished saying is in the thread, word for word;
 *   - every tool call is a row (none folded away, none counted twice);
 *   - while it runs, the live line names something;
 *   - a run that completed never reads as failed.
 * And `THREAD_TEXT` below holds what each recording's finished thread SAYS,
 * so a change to the look shows its effect on every runtime as a diff here
 * before it ships. Update it deliberately (`LOCUST_THREAD_TEXT=1` prints it).
 */

const FIXTURES = import.meta.glob('../../../../../packages/runtime-adapters/test/fixtures/**/*.jsonl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const NOW = '2026-10-03T12:00:00.000Z'
const now = (): Date => new Date(NOW)

interface Recording {
  readonly name: string
  readonly runtime: string
  readonly records: readonly string[]
}

const completion = (recordCount: number) => ({
  exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount, cancelled: false,
  forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false,
  oversizedRecordsDropped: 0, startedAt: NOW, finishedAt: NOW
})

const linesOf = (raw: string): string[] => raw.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line.trim().length > 0)

/** The ACP transcripts as acp-run.ts turns them into records (see acp-events.test.ts). */
function acpRecords(raw: string): string[] {
  type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> }
  const records: string[] = []
  const push = (method: string, params: unknown): void => { records.push(JSON.stringify({ method, params })) }
  const sessionCalls = new Map<number, string | undefined>()
  const asked = new Map<number, { toolCallId: string; options: Array<{ optionId: string; kind: string }> }>()
  let prompted = false
  for (const line of linesOf(raw).map((one) => JSON.parse(one) as { dir: string; message?: Message })) {
    const message = line.message
    if (message === undefined) continue
    if (line.dir === 'out') {
      if (message.method === 'session/new' || message.method === 'session/load' || message.method === 'session/resume') sessionCalls.set(message.id!, message.params?.sessionId as string | undefined)
      if (message.method === 'session/prompt') prompted = true
      const chosen = (message.result?.outcome as { optionId?: string } | undefined)?.optionId
      const request = message.method === undefined && message.id !== undefined ? asked.get(message.id) : undefined
      const kind = request?.options.find((option) => option.optionId === chosen)?.kind ?? ''
      if (request !== undefined && kind.startsWith('reject')) push(ACP_DECLINED, { toolCallId: request.toolCallId })
      continue
    }
    if (line.dir !== 'in') continue
    if (message.id !== undefined && message.result !== undefined && sessionCalls.has(message.id)) push(ACP_SESSION, { sessionId: message.result.sessionId ?? sessionCalls.get(message.id) })
    if (message.method === 'session/update' && prompted) push('session/update', message.params)
    if (message.method === 'session/request_permission' && message.id !== undefined) {
      asked.set(message.id, { toolCallId: (message.params?.toolCall as { toolCallId: string }).toolCallId, options: message.params?.options as Array<{ optionId: string; kind: string }> })
    }
    if (message.result?.stopReason !== undefined) push(ACP_PROMPT_RESULT, message.result)
  }
  return records
}

/** Codex app-server's recorded session as codex-app-server-run.ts records it: each notification it was sent, in order. */
function codexRecords(raw: string): string[] {
  return linesOf(raw)
    .map((line) => JSON.parse(line) as { dir: string; message?: { id?: unknown; method?: unknown; params?: unknown } })
    .filter((row) => row.dir === 'in' && typeof row.message?.method === 'string' && row.message.id === undefined)
    .map((row) => JSON.stringify({ method: row.message!.method, params: row.message!.params ?? null }))
}

/** OpenCode's server events as opencode-serve-run.ts turns them into `run`'s records. */
function serveRecords(raw: string): string[] {
  type Json = Record<string, unknown>
  const roles = new Map<string, string>()
  const emitted = new Set<string>()
  const records: string[] = []
  for (const event of linesOf(raw).map((one) => JSON.parse(one) as { type: string; properties: Json })) {
    const props = event.properties
    if (event.type === 'message.updated') {
      const info = props.info as Json
      if (typeof info.id === 'string' && typeof info.role === 'string') roles.set(info.id, info.role)
    }
    if (event.type === 'message.part.updated') {
      const part = props.part as Json
      const record = runRecordFor(part as never, roles.get(String(part.messageID)))
      if (record === undefined) continue
      const key = `${record.type}:${String(part.id)}`
      if (emitted.has(key)) continue
      emitted.add(key)
      records.push(JSON.stringify({ ...record, timestamp: 0, sessionID: props.sessionID }))
    }
  }
  return records
}

const RECORDINGS: readonly Recording[] = Object.entries(FIXTURES)
  .map(([path, raw]) => {
    const [folder, file] = path.split('/fixtures/')[1]!.split('/') as [string, string]
    const name = `${folder}/${file}`
    if (folder === 'acp') return { name, runtime: file.startsWith('copilot') ? 'acp-copilot' : 'acp-opencode', records: acpRecords(raw) }
    if (folder === 'codex') return { name, runtime: 'codex', records: codexRecords(raw) }
    if (file === 'serve-events.jsonl') return { name, runtime: 'opencode-serve', records: serveRecords(raw) }
    return { name, runtime: folder.startsWith('agy') ? 'agy' : folder, records: linesOf(raw) }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

function normalizerFor(runtime: string) {
  const base = { runId: 'run_1', missionId: 'mission_1', now }
  switch (runtime) {
    case 'acp-copilot': return createAcpEventNormalizer({ ...base, runtime: 'copilot' } as never)
    case 'acp-opencode': return createAcpEventNormalizer({ ...base, runtime: 'opencode' } as never)
    case 'agy': return createAgyEventNormalizer(base)
    case 'antigravity': return createAntigravityEventNormalizer({ ...base, conversationId: '03a2fcb4-8fd9-468e-a683-6bf3a5acd077' })
    case 'claude': return createClaudeEventNormalizer(base)
    case 'codex': return asProcessNormalizer(createAppServerEventNormalizer(base))
    case 'copilot': return createCopilotEventNormalizer({ ...base, cliVersion: '1.0.88', sessionId: '11111111-2222-3333-4444-555555555555' })
    case 'cursor': return createCursorEventNormalizer({ ...base, cliVersion: '2026.08.31-4057e58' })
    case 'muse': return createMuseEventNormalizer({ ...base, cliVersion: '1.3.0' })
    case 'opencode':
    case 'opencode-serve': return createOpenCodeEventNormalizer({ ...base, cliVersion: '1.18.27' })
    default: throw new Error(`no normalizer for ${runtime}`)
  }
}

/** The run's events, and the event count after each record, so a run can be cut where a record ended. */
function replay(recording: Recording): { readonly events: readonly NormalizedRuntimeEvent[]; readonly cuts: readonly number[] } {
  const normalizer = normalizerFor(recording.runtime) as { accept(record: { sequence: number; raw: string }): readonly NormalizedRuntimeEvent[]; finish(completion: unknown): readonly NormalizedRuntimeEvent[] }
  const events: NormalizedRuntimeEvent[] = []
  const cuts: number[] = []
  recording.records.forEach((raw, index) => {
    events.push(...normalizer.accept({ sequence: index + 1, raw }))
    cuts.push(events.length)
  })
  events.push(...normalizer.finish(completion(recording.records.length)))
  return { events, cuts }
}

const flat = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const drawn = (items: readonly ThreadItem[], running: boolean): string =>
  flat(renderToStaticMarkup(<ThreadItems items={items} owner={undefined} activity={running ? 'working' : 'idle'} workspacePath="C:/work" decision={undefined} />))

type Payload = { itemId?: string; toolKind?: string; operation?: string; text?: string; message?: string }
const payloadOf = (event: NormalizedRuntimeEvent): Payload => event.payload as unknown as Payload
const TOOL_EVENT = new Set(['tool.started', 'tool.completed', 'tool.failed'])
const SETTLED = new Set(['tool.completed', 'tool.failed'])
/** A host's own disk observation can join the runtime's row for the same file; it is not a call the runtime made. */
const runtimeCalls = (events: readonly NormalizedRuntimeEvent[], settledOnly: boolean): Set<string> =>
  new Set(events.filter((event) => (settledOnly ? SETTLED : TOOL_EVENT).has(event.type) && payloadOf(event).toolKind !== 'observed_edit').map((event) => String(payloadOf(event).itemId)))
/** What the runtime said, message by message, as the checkpoint summary rebuilds it. */
const saidIn = (events: readonly NormalizedRuntimeEvent[]): string[] => {
  const said = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'message.delta') continue
    const { itemId, operation, text } = payloadOf(event)
    said.set(String(itemId), operation === 'replace' ? String(text) : `${said.get(String(itemId)) ?? ''}${String(text)}`)
  }
  return [...said.values()].map((text) => text.trim()).filter((text) => text.length > 0)
}
const shownIn = (items: readonly ThreadItem[]): string[] => items.flatMap((item) => (item.type === 'agent-message' ? [item.text.trim()] : []))
/** Its rows: a reasoning row is the model thinking, not a call. */
const rowsIn = (items: readonly ThreadItem[]) => items.flatMap((item) => (item.type === 'steps' ? item.details : [])).filter((detail) => detail.kind !== 'reasoning' && detail.kind !== 'thought')
/** The words of a message, in order: a link's address, a list's numbers and the markdown marks are not drawn as text. */
const wordsOf = (text: string): string[] => text.replace(/\]\([^)]*\)/g, ']').replace(/^\s*\d+[.)]\s/gm, '').match(/[\p{L}\p{N}]+/gu) ?? []
const inOrder = (needles: readonly string[], haystack: readonly string[]): boolean => {
  let at = 0
  for (const word of haystack) if (at < needles.length && word === needles[at]) at += 1
  return at === needles.length
}
const RUN_FAILED = /ended without a reply|No answer was recorded|the run failed|could not run it|ended without a record|did not finish/i
const finishedThread = (events: readonly NormalizedRuntimeEvent[]) => buildThread(events, { running: false, latestTurn: true, workspacePath: 'C:/work' })

describe.each(RECORDINGS)('$name, through the thread', (recording) => {
  const { events, cuts } = replay(recording)
  const items = finishedThread(events)
  const text = drawn(items, false)
  const ending = events.at(-1)?.type

  it('shows every message the runtime finished, word for word, and draws each', () => {
    expect(shownIn(items)).toEqual(saidIn(events))
    const drawnWords = wordsOf(text)
    for (const message of saidIn(events)) expect(inOrder(wordsOf(message), drawnWords), message).toBe(true)
  })

  it('says no remark twice in one turn', () => {
    const remarks = items.flatMap((item) => (item.type === 'diagnostic' ? [item.message] : item.type === 'activity' ? (item.notices ?? []).map((notice) => notice.message) : []))
    expect(remarks).toEqual([...new Set(remarks)])
  })

  it('draws every call it made as one row', () => {
    expect(rowsIn(items).length).toBe(runtimeCalls(events, false).size)
  })

  it(ending === 'run.failed' ? 'says why it failed' : 'does not read as failed', () => {
    if (ending === 'run.failed') {
      expect(String(payloadOf(events.at(-1)!).message ?? '').trim().length).toBeGreaterThan(0)
      return
    }
    expect(ending).toBe('run.completed')
    expect(text).not.toMatch(RUN_FAILED)
  })

  it('while it runs: names what it is doing, keeps what it said, and only the newest message types', () => {
    for (const cut of new Set(cuts)) {
      const sofar = events.slice(0, cut)
      if (sofar.some((event) => event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled')) continue
      const live = buildThread(sofar, { running: true, startedAt: NOW, latestTurn: true, workspacePath: 'C:/work' })
      const where = `${recording.name} after ${String(cut)} events`
      expect(() => drawn(live, true), where).not.toThrow()
      expect(shownIn(live), where).toEqual(saidIn(sofar))
      const messages = live.filter((item) => item.type === 'agent-message')
      const typing = messages.filter((item) => item.type === 'agent-message' && item.streaming)
      expect(typing.length, where).toBeLessThanOrEqual(1)
      if (typing.length === 1) expect(typing[0], where).toBe(messages.at(-1))
      // Something always says the run is going: the live line, naming what it
      // is doing -- or, while a message is being written, that message's caret.
      const line = live.filter((item) => item.type === 'live-step')
      expect(line.length, where).toBe(typing.length === 1 ? line.length : 1)
      expect(line.length, where).toBeLessThanOrEqual(1)
      const step = line[0]
      if (step?.type === 'live-step') expect((step.action ?? step.label).trim().length, where).toBeGreaterThan(0)
      expect(rowsIn(live).length, where).toBe(runtimeCalls(sofar, true).size)
    }
  }, 60_000)
})

/**
 * WHAT EACH RUNTIME'S FINISHED THREAD SAYS, kept beside this file. A change
 * to the look changes this text for every runtime it reaches, and the diff
 * is the review: read it, and if every line is still what that runtime did,
 * re-run with `-u` to keep it.
 */
it('says what each recorded run said, as kept', async () => {
  const kept = RECORDINGS.map((recording) => {
    const { events } = replay(recording)
    const said = drawn(finishedThread(events), false).replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\person\\')
    return `## ${recording.name}\n${said.length === 0 ? '(nothing in the thread)' : said}\n`
  }).join('\n')
  await expect(kept).toMatchFileSnapshot('./every-runtime-keeps-its-output.thread-text.txt')
})
