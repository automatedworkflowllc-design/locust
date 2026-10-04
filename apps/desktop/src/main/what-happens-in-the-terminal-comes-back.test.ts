import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedger, MissionLedgerMetadata } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { runtimeThreadIdOf } from './codex-mission.js'
import { newestTurnOf } from './mission-history.js'
import { catchUpTerminal, claudeTerminalExchanges, codexTerminalExchanges, createTerminalCatchUp, createTerminalImports, createTranscriptReader } from './terminal-catch-up.js'
import type { CatchUpFacts } from './terminal-catch-up.js'

/**
 * WHAT HAPPENS IN THE TERMINAL COMES BACK (0.391).
 *
 * Colin, 2026-09-27: "wont we want to be able to keep up on projects our
 * users carry on w/ terminal?" The shapes below are the measured ones
 * (docs/PLAN-TERMINAL-CATCH-UP-2026-09-27.md): Claude's `entrypoint` says
 * where a prompt was typed -- `cli` the terminal, `sdk-cli` Locust's print
 * mode -- and a Codex rollout is ordered by time. The lines a runtime writes
 * in the person's place were counted in real session files the same day.
 */
const SESSION = '5f0c2a1e-8d4b-4c6a-9e2f-1b3c4d5e6f70'
const T0 = '2026-09-27T10:00:00.000Z'
const claudeLine = (value: Record<string, unknown>): string => JSON.stringify({ sessionId: SESSION, cwd: 'C:\\work', isSidechain: false, ...value })
const typed = (text: string, at: string, entrypoint: 'cli' | 'sdk-cli', extra: Record<string, unknown> = {}): string =>
  claudeLine({ type: 'user', entrypoint, timestamp: at, uuid: `u-${at}`, message: { role: 'user', content: text }, ...extra })
const blocks = (text: string, at: string): string =>
  claudeLine({ type: 'user', entrypoint: 'cli', timestamp: at, uuid: `b-${at}`, message: { role: 'user', content: [{ type: 'text', text }] } })
const answer = (text: string, at: string, stop: 'end_turn' | 'tool_use' = 'end_turn'): string =>
  claudeLine({ type: 'assistant', timestamp: at, uuid: `a-${at}`, message: { role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, content: [{ type: 'text', text }] } })
const toolResult = (at: string): string => claudeLine({ type: 'user', entrypoint: 'cli', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })

const CLAUDE_SESSION = [
  // Locust's own turn, in print mode, before the terminal.
  typed('Who takes what?', '2026-09-27T09:58:00.000Z', 'sdk-cli'),
  answer('Wren takes the migrations.', '2026-09-27T09:59:00.000Z'),
  // In the terminal, after.
  typed('Now add tests for the migrations.', '2026-09-27T10:05:00.000Z', 'cli'),
  answer('Looking at the migration files first.', '2026-09-27T10:05:10.000Z', 'tool_use'),
  toolResult('2026-09-27T10:05:20.000Z'),
  answer('Added three tests; all pass.', '2026-09-27T10:06:00.000Z'),
  blocks('[Request interrupted by user]', '2026-09-27T10:06:05.000Z'),
  // A command Claude did not answer, then a compacted session's summary.
  typed('<command-name>/model</command-name>', '2026-09-27T10:06:10.000Z', 'cli'),
  typed('<local-command-stdout>Set model to Opus</local-command-stdout>', '2026-09-27T10:06:11.000Z', 'cli'),
  typed('This session is being continued from a previous conversation.', '2026-09-27T10:06:20.000Z', 'cli', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
  // A command it did answer: a skill.
  typed('<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>the diff</command-args>', '2026-09-27T10:06:40.000Z', 'cli'),
  typed('Review the diff carefully.', '2026-09-27T10:06:41.000Z', 'cli', { isMeta: true }),
  answer('The diff looks right.', '2026-09-27T10:06:50.000Z'),
  typed('Commit them.', '2026-09-27T10:07:00.000Z', 'cli', { promptSource: 'queued' }),
  answer('Committed as "Add migration tests".', '2026-09-27T10:07:30.000Z'),
  typed('Something the system said.', '2026-09-27T10:07:40.000Z', 'cli', { promptSource: 'system' })
].join('\n')

describe("Claude's terminal exchanges", () => {
  it('are the prompts typed in the terminal after the turn, each with its last words in answer', () => {
    const exchanges = claudeTerminalExchanges(CLAUDE_SESSION, T0)
    expect(exchanges.map((exchange) => [exchange.prompt, exchange.answer])).toEqual([
      ['Now add tests for the migrations.', 'Added three tests; all pass.'],
      ['/review the diff', 'The diff looks right.'],
      ['Commit them.', 'Committed as "Add migration tests".']
    ])
    expect(exchanges[0]).toMatchObject({ startedAt: '2026-09-27T10:05:00.000Z', finishedAt: '2026-09-27T10:06:00.000Z', model: 'claude-opus-5-5' })
  })

  it("never take Locust's own print-mode turn, or its answer, for the terminal's", () => {
    const withLocustAfter = [CLAUDE_SESSION, typed('Locust again.', '2026-09-27T10:09:00.000Z', 'sdk-cli'), answer("Locust's answer.", '2026-09-27T10:09:30.000Z')].join('\n')
    const answers = claudeTerminalExchanges(withLocustAfter, T0).map((exchange) => exchange.answer)
    expect(answers).not.toContain("Locust's answer.")
    expect(answers.at(-1)).toBe('Committed as "Add migration tests".')
    expect(claudeTerminalExchanges(CLAUDE_SESSION, '2026-09-27T10:06:55.000Z').map((exchange) => exchange.prompt)).toEqual(['Commit them.'])
  })

  it('hold back an exchange still going, so no answer comes back half-written', () => {
    const going = [CLAUDE_SESSION, typed('One more thing.', '2026-09-27T10:08:00.000Z', 'cli'), answer('Reading the file.', '2026-09-27T10:08:10.000Z', 'tool_use')].join('\n')
    expect(claudeTerminalExchanges(going, T0).map((exchange) => exchange.prompt)).not.toContain('One more thing.')
    const finished = [going, toolResult('2026-09-27T10:08:20.000Z'), answer('Done.', '2026-09-27T10:08:30.000Z')].join('\n')
    expect(claudeTerminalExchanges(finished, T0).at(-1)).toMatchObject({ prompt: 'One more thing.', answer: 'Done.' })
  })

  it('count an exchange over when its turn closed, or the person stopped it', () => {
    const closed = [typed('Check the build.', '2026-09-27T10:05:00.000Z', 'cli'), answer('Checking.', '2026-09-27T10:05:10.000Z', 'tool_use'), claudeLine({ type: 'system', subtype: 'turn_duration', timestamp: '2026-09-27T10:05:30.000Z' })].join('\n')
    expect(claudeTerminalExchanges(closed, T0).map((exchange) => exchange.answer)).toEqual(['Checking.'])
    const stopped = [typed('Check the build.', '2026-09-27T10:05:00.000Z', 'cli'), answer('Checking.', '2026-09-27T10:05:10.000Z', 'tool_use'), blocks('[Request interrupted by user for tool use]', '2026-09-27T10:05:20.000Z')].join('\n')
    expect(claudeTerminalExchanges(stopped, T0).map((exchange) => exchange.answer)).toEqual(['Checking.'])
  })
})

const codexLine = (at: string, type: string, payload: Record<string, unknown>): string => JSON.stringify({ timestamp: at, type, payload })
const codexSaid = (at: string, role: 'user' | 'assistant', text: string): string =>
  codexLine(at, 'response_item', { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] })
const CODEX_ROLLOUT = [
  codexSaid('2026-09-27T09:58:00.000Z', 'user', 'Who takes what?'),
  codexSaid('2026-09-27T09:59:00.000Z', 'assistant', 'Wren takes the migrations.'),
  codexLine('2026-09-27T10:05:00.000Z', 'turn_context', { model: 'gpt-6-sol' }),
  codexSaid('2026-09-27T10:05:00.300Z', 'user', '# AGENTS.md instructions for C:\\work\n\n<INSTRUCTIONS>\nBe brief.\n</INSTRUCTIONS>'),
  codexSaid('2026-09-27T10:05:00.500Z', 'user', '<environment_context>cwd</environment_context>'),
  codexSaid('2026-09-27T10:05:01.000Z', 'user', 'Add tests.'),
  codexSaid('2026-09-27T10:05:30.000Z', 'assistant', 'Reading first.'),
  codexSaid('2026-09-27T10:06:00.000Z', 'assistant', 'Tests added.'),
  codexLine('2026-09-27T10:06:00.500Z', 'event_msg', { type: 'task_complete' })
].join('\n')

describe("Codex's terminal turns", () => {
  it('are the typed turns after the conversation’s last, each with its last answer; injected context is not a prompt', () => {
    expect(codexTerminalExchanges(CODEX_ROLLOUT, T0).map((exchange) => [exchange.prompt, exchange.answer, exchange.model])).toEqual([['Add tests.', 'Tests added.', 'gpt-6-sol']])
  })

  it('hold back a turn still going', () => {
    const going = CODEX_ROLLOUT.split('\n').slice(0, -1).join('\n')
    expect(codexTerminalExchanges(going, T0)).toEqual([])
  })
})

describe("a session's transcript", () => {
  it('is found by the session’s own name, and read again only when it changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-transcripts-'))
    const claudeFile = join(root, 'claude', 'projects', 'C--work', `${SESSION}.jsonl`)
    const codexFile = join(root, 'codex', 'sessions', '2026', '09', '27', `rollout-2026-09-27T09-58-00-${SESSION}.jsonl`)
    await mkdir(join(root, 'claude', 'projects', 'C--other'), { recursive: true })
    await mkdir(dirname(claudeFile), { recursive: true })
    await mkdir(dirname(codexFile), { recursive: true })
    await writeFile(claudeFile, CLAUDE_SESSION)
    await writeFile(codexFile, CODEX_ROLLOUT)
    const read = createTranscriptReader({ claudeHome: join(root, 'claude'), codexHome: join(root, 'codex') })
    expect(await read('claude', SESSION)).toBe(CLAUDE_SESSION)
    expect(await read('claude', SESSION)).toBeUndefined()
    await appendFile(claudeFile, `\n${typed('More.', '2026-09-27T10:09:00.000Z', 'cli')}`)
    expect(await read('claude', SESSION)).toContain('More.')
    expect(await read('codex', SESSION)).toBe(CODEX_ROLLOUT)
    expect(await read('claude', 'not a session')).toBeUndefined()
  })
})

const PROCESS = { signal: null, stderr: '', stderrTruncated: false, recordCount: 2, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, forcedTerminationAttempted: false, terminationUnconfirmed: false }

/** A turn Locust ran on the session, as the ledger records one; still running without `finishedAt`. */
async function recordTurn(
  ledger: MissionLedger,
  runtime: 'claude' | 'codex',
  missionId: string,
  startedAt: string,
  finishedAt: string | undefined,
  continuesFrom?: string
): Promise<void> {
  const runId = `run_${missionId}`
  await ledger.createMission({
    missionId,
    runId,
    prompt: 'Who takes what?',
    runtime,
    model: 'opus',
    requestedRouteId: `${runtime}:opus`,
    resolvedRouteId: `${runtime}:opus`,
    cliVersion: '2.1.283',
    workspaceId: 'ws_1',
    sandbox: 'workspace-write',
    executionPolicyVersion: 1,
    createdAt: startedAt,
    ...(continuesFrom === undefined ? {} : { continuesFrom: { missionId: continuesFrom, checkpointEpoch: 1, reason: 'follow-up', runtimeThreadId: SESSION } })
  } as MissionLedgerMetadata)
  const base = { runId, missionId, sourceAdapter: runtime, runtimeThreadId: SESSION }
  await ledger.appendEvents(missionId, [
    { ...base, id: `${runId}:1`, sequence: 1, occurredAt: startedAt, type: 'run.started', payload: { runtimeThreadId: SESSION, evidence: { redacted: true } } },
    ...(finishedAt === undefined
      ? []
      : [{ ...base, id: `${runId}:2`, sequence: 2, occurredAt: finishedAt, type: 'run.completed', payload: { runtimeThreadId: SESSION, process: { ...PROCESS, exitCode: 0, startedAt, finishedAt } } }])
  ] as unknown as NormalizedRuntimeEvent[])
}

async function withConversation(runtime: 'claude' | 'codex', transcript: string) {
  const root = await mkdtemp(join(tmpdir(), 'locust-catch-up-'))
  const ledger = createFileMissionLedger({ rootDirectory: join(root, 'ledger') })
  await recordTurn(ledger, runtime, 'mission_first', '2026-09-27T09:58:00.000Z', T0)
  const assigned: [string, string][] = []
  let ids = 0
  const facts: CatchUpFacts = {
    ledger,
    liveMissionIds: () => [],
    sessionOf: runtimeThreadIdOf,
    transcriptOf: async () => transcript,
    imports: createTerminalImports(join(root, 'terminal-imports.json')),
    ownerOf: async () => 'tm_wren',
    assign: async (teammateId, missionId) => {
      assigned.push([teammateId, missionId])
    },
    newestTurnOf: (missionId) => newestTurnOf(ledger, missionId),
    createId: () => `id${String(++ids)}`
  }
  return { ledger, facts, assigned, root }
}

describe('catching up', () => {
  it('records each terminal exchange as the next turn of the conversation, owned by its teammate, readable by the ledger', async () => {
    const { ledger, facts, assigned } = await withConversation('claude', CLAUDE_SESSION)
    const result = await catchUpTerminal('mission_first', facts)
    expect(result).toEqual({ imported: 3, latestMissionId: 'mission_id5', owners: { mission_id1: 'tm_wren', mission_id3: 'tm_wren', mission_id5: 'tm_wren' } })
    const first = await ledger.getMission('mission_id1')
    const last = await ledger.getMission('mission_id5')
    expect(first?.issues).toEqual([])
    expect(first?.phase).toBe('completed')
    expect(first?.metadata).toMatchObject({
      prompt: 'Now add tests for the migrations.',
      runtime: 'claude',
      startedBy: { kind: 'terminal', exchange: 1 },
      continuesFrom: { missionId: 'mission_first', reason: 'follow-up', runtimeThreadId: SESSION }
    })
    expect(first?.metadata.command).toBeUndefined()
    expect(first?.metadata.mode).toBeUndefined()
    expect(last?.issues).toEqual([])
    expect(last?.metadata).toMatchObject({ startedBy: { kind: 'terminal', exchange: 3 }, continuesFrom: { missionId: 'mission_id3' } })
    const said = last?.events.find((event) => event.type === 'message.delta')
    expect(said?.type === 'message.delta' && said.payload.text).toBe('Committed as "Add migration tests".')
    // It continues the same session, so a follow-up here resumes it.
    expect(last === undefined ? undefined : runtimeThreadIdOf(last)).toBe(SESSION)
    expect(assigned).toEqual([['tm_wren', 'mission_id1'], ['tm_wren', 'mission_id3'], ['tm_wren', 'mission_id5']])
  })

  it('brings nothing back twice, whichever turn it is asked from', async () => {
    const { facts } = await withConversation('claude', CLAUDE_SESSION)
    const first = await catchUpTerminal('mission_first', facts)
    expect(await catchUpTerminal('mission_first', facts)).toEqual({ imported: 0, latestMissionId: first.latestMissionId })
    expect(await catchUpTerminal(first.latestMissionId, facts)).toEqual({ imported: 0, latestMissionId: first.latestMissionId })
  })

  it('brings nothing back twice when asked twice at once', async () => {
    const { ledger, facts } = await withConversation('claude', CLAUDE_SESSION)
    const catchUp = createTerminalCatchUp(facts)
    const both = await Promise.all([catchUp('mission_first'), catchUp('mission_first')])
    expect(both.map((result) => result.imported)).toEqual([3, 0])
    const terminalTurns = (await ledger.listMissions()).missions.filter((mission) => mission.metadata.startedBy?.kind === 'terminal')
    expect(terminalTurns).toHaveLength(3)
  })

  it('leaves a running conversation alone', async () => {
    const { facts } = await withConversation('claude', CLAUDE_SESSION)
    expect(await catchUpTerminal('mission_first', { ...facts, liveMissionIds: () => ['mission_first'] })).toEqual({ imported: 0, latestMissionId: 'mission_first' })
  })

  it("reads Codex's rollout the same way", async () => {
    const { ledger, facts, root } = await withConversation('codex', CODEX_ROLLOUT)
    const result = await catchUpTerminal('mission_first', facts)
    expect(result.imported).toBe(1)
    const turn = await ledger.getMission(result.latestMissionId)
    expect(turn?.issues).toEqual([])
    expect(turn?.metadata.prompt).toBe('Add tests.')
    const held = JSON.parse(await readFile(join(root, 'terminal-imports.json'), 'utf8')) as Record<string, { through: string }>
    expect(held[SESSION]?.through).toBe('2026-09-27T10:06:00.000Z')
  })

  it("never takes Locust's own later Codex turn for the terminal's, when an older turn is named", async () => {
    // The rollout's "Add tests." was Locust's own follow-up: a window that
    // still names the first turn must not bring it back as the terminal's.
    const { ledger, facts } = await withConversation('codex', CODEX_ROLLOUT)
    await recordTurn(ledger, 'codex', 'mission_second', '2026-09-27T10:05:00.000Z', '2026-09-27T10:06:00.000Z', 'mission_first')
    expect(await catchUpTerminal('mission_first', facts)).toEqual({ imported: 0, latestMissionId: 'mission_first' })
  })

  it('waits while the newest turn is still running, even when an older one is named', async () => {
    const { ledger, facts } = await withConversation('codex', CODEX_ROLLOUT)
    await recordTurn(ledger, 'codex', 'mission_second', '2026-09-27T10:05:00.000Z', undefined, 'mission_first')
    expect(await catchUpTerminal('mission_first', { ...facts, liveMissionIds: () => ['mission_second'] })).toEqual({ imported: 0, latestMissionId: 'mission_first' })
  })

  it('does not bring back a terminal turn the person deleted', async () => {
    const { ledger, facts } = await withConversation('claude', CLAUDE_SESSION)
    await catchUpTerminal('mission_first', facts)
    for (const turn of ['mission_id1', 'mission_id3', 'mission_id5']) expect(await ledger.deleteMission(turn)).toBe(true)
    expect(await catchUpTerminal('mission_first', facts)).toEqual({ imported: 0, latestMissionId: 'mission_first' })
  })
})

describe("a conversation's newest turn", () => {
  it('is found from any turn of it, the latest-made where it branches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-newest-'))
    const ledger = createFileMissionLedger({ rootDirectory: join(root, 'ledger') })
    await recordTurn(ledger, 'claude', 'mission_first', '2026-09-27T09:58:00.000Z', T0)
    await recordTurn(ledger, 'claude', 'mission_second', '2026-09-27T10:05:00.000Z', '2026-09-27T10:06:00.000Z', 'mission_first')
    await recordTurn(ledger, 'claude', 'mission_third', '2026-09-27T10:07:00.000Z', '2026-09-27T10:08:00.000Z', 'mission_first')
    await recordTurn(ledger, 'claude', 'mission_fourth', '2026-09-27T10:09:00.000Z', '2026-09-27T10:10:00.000Z', 'mission_third')
    expect(await newestTurnOf(ledger, 'mission_first')).toBe('mission_fourth')
    expect(await newestTurnOf(ledger, 'mission_second')).toBe('mission_second')
    expect(await newestTurnOf(ledger, 'mission_fourth')).toBe('mission_fourth')
  })
})
