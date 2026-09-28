import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MissionLedger, Workroom } from '@teammate/mission-store'
import type {
  RuntimeDiscovery,
  RuntimeProcessCompletion,
  RuntimeProcessRecordStream,
  RuntimeProcessRun
} from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBriefSessions } from './brief-sessions.js'
import { createCodexMissionService } from './codex-mission.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A RUNTIME'S OWN COMMAND IS SENT AS THE PERSON TYPED IT (0.426).
 *
 * A CLI reads a slash command only at the very start of what it is given, and
 * every turn used to be wrapped in the brief, so `/compact` arrived as the
 * last line of a long prompt and was just words. The direct-message handler
 * says when the person typed one (runtime-commands.ts); nothing else may.
 */
const NOW = '2026-09-28T15:00:00.000Z'
const PEER: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' },
  others: [{ teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }]
}
const ROSTER_RULE = 'Writing a teammate\'s name in your reply does NOT reach them.'

describe('a command the person typed', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-runtime-command-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  const runtime: RuntimeDiscovery = {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: {
      commandName: 'codex',
      discoveredPath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      executablePath: process.platform === 'win32' ? 'C:\\tools\\codex.exe' : '/tools/codex',
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: 'codex-cli 0.151.0', version: '0.151.0', major: 0, minor: 151, patch: 0 },
    supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    diagnostics: []
  }
  const completion = (): RuntimeProcessCompletion => ({
    exitCode: 0,
    signal: null,
    stderr: '',
    stderrTruncated: false,
    recordCount: 2,
    cancelled: false,
    forcedTerminationAttempted: false,
    terminationUnconfirmed: false,
    inputDeliveryFailed: false,
    outputLimitExceeded: false,
    oversizedRecordsDropped: 0,
    startedAt: NOW,
    finishedAt: NOW
  })
  const stream = (values: readonly Record<string, unknown>[]): RuntimeProcessRecordStream => ({
    async *[Symbol.asyncIterator]() {
      for (const [index, value] of values.entries()) yield { sequence: index + 1, raw: JSON.stringify(value) }
    },
    drainAvailable: () => []
  })
  const workroom: Workroom = {
    post: async () => {
      throw new Error('not used')
    },
    unread: async () => ({ messages: [], remaining: 0 }),
    markDelivered: async () => undefined,
    read: async () => ({ messages: [], deliveries: [], issues: [] }),
    flush: async () => undefined
  }
  const prior = (missionId: string, runtimeId = 'codex') => ({
    metadata: {
      missionId,
      runId: 'run_prior',
      prompt: 'earlier',
      runtime: runtimeId,
      model: 'account-default',
      requestedRouteId: runtimeId,
      resolvedRouteId: 'codex-account:default',
      cliVersion: null,
      workspaceId: 'ws_test',
      sandbox: 'read-only',
      mode: 'plan',
      executionPolicyVersion: 1,
      createdAt: NOW
    },
    events: [
      { id: 'e1', runId: 'run_prior', missionId, sequence: 1, type: 'run.started', occurredAt: NOW, sourceAdapter: runtimeId, payload: { runtimeThreadId: 'thread-1', evidence: { redacted: true } } }
    ],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    editChecks: [],
    phase: 'completed',
    lastUpdatedAt: NOW,
    ledgerSequence: 1,
    issues: []
  })

  const setUp = (discovered: RuntimeDiscovery = runtime) => {
    const recorded: string[] = []
    const ledger = {
      createMission: async (metadata: { prompt: string }) => {
        recorded.push(metadata.prompt)
      },
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => {
        throw new Error('not used')
      },
      appendPeerLinks: async () => undefined, appendEditCheck: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
      storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
      pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async (missionId: string) => prior(missionId, discovered.id),
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: stream(discovered.id === 'claude'
        ? [{ type: 'system', subtype: 'init', session_id: 'thread-1' }, { type: 'result', subtype: 'success', is_error: false, result: 'OK', session_id: 'thread-1' }]
        : [{ type: 'thread.started', thread_id: 'thread-1' }, { type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    }))
    const scheduled: Array<() => void> = []
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace',
      discover: async () => [discovered],
      runner: { start },
      ledger,
      workroom,
      briefSessions: createBriefSessions({ rootDirectory: folder }),
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task)
    })
    const drain = async (): Promise<void> => {
      while (scheduled.length > 0) scheduled.shift()!()
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    }
    const sent = (call: number): string => start.mock.calls[call]?.[1] as string
    const argv = (call: number): readonly string[] => (start.mock.calls[call]?.[0] as { args: readonly string[] }).args
    return { service, drain, sent, argv, recorded }
  }

  // Claude Code: a Codex command goes as its app-server's own request (0.428).
  const claude = (): RuntimeDiscovery => ({ ...runtime, id: 'claude', displayName: 'Claude Code', executable: { ...runtime.executable!, commandName: 'claude' } })

  it('goes to the runtime alone, with no brief and no plan instruction after it', async () => {
    const { service, sent, recorded } = setUp(claude())
    const typed = await service.start('  /compact keep the test names  ', 'claude', 'plan', {}, () => undefined, undefined, PEER, undefined, undefined, undefined, true)
    expect(typed.ok).toBe(true)
    expect(sent(0)).toBe('/compact keep the test names')
    // The record keeps what the person typed, as for any message.
    expect(recorded[0]).toBe('  /compact keep the test names  ')
  })

  it('is briefed like any message when the words came from a routine, whatever the caller says', async () => {
    const { service, sent } = setUp()
    const replayed = await service.start('/compact', 'codex', 'ask', {}, () => undefined, undefined, PEER, undefined, undefined, { kind: 'routine', routineId: 'rt_1', step: 1 }, true)
    expect(replayed.ok).toBe(true)
    expect(sent(0)).toContain(ROSTER_RULE)
    expect(sent(0).endsWith('/compact')).toBe(true)
  })

  it('is briefed like any message when nobody said it was a command', async () => {
    const { service, sent } = setUp()
    await service.start('/compact', 'codex', 'ask', {}, () => undefined, undefined, PEER)
    expect(sent(0)).toContain(ROSTER_RULE)
  })

  it('leaves the next turn briefed in full, since the command may have cleared or compacted the session', async () => {
    const { service, drain, sent } = setUp(claude())
    const first = await service.start('Look around.', 'claude', 'ask', {}, () => undefined, undefined, PEER)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    await drain()
    const command = await service.start('/clear', 'claude', 'ask', {}, () => undefined, undefined, PEER, first.data.missionId, undefined, undefined, true)
    expect(command.ok, JSON.stringify(command)).toBe(true)
    if (!command.ok) return
    await drain()
    await service.start('What next?', 'claude', 'ask', {}, () => undefined, undefined, PEER, command.data.missionId)
    expect(sent(1)).toBe('/clear')
    expect(sent(2)).toContain(ROSTER_RULE)
    expect(sent(2).endsWith('What next?')).toBe(true)
  })

  it("goes to OpenCode by name, with only what follows the name as its message (0.427)", async () => {
    const opencode: RuntimeDiscovery = { ...runtime, id: 'opencode', displayName: 'OpenCode', executable: { ...runtime.executable!, commandName: 'opencode' } }
    const { service, drain, sent, argv } = setUp(opencode)
    const typed = await service.start('/init keep it under five lines', 'opencode', 'ask', { model: 'opencode/nemotron-3-ultra-free' }, () => undefined, undefined, PEER, undefined, undefined, undefined, true)
    expect(typed.ok).toBe(true)
    await drain()
    expect(argv(0)[argv(0).indexOf('--command') + 1]).toBe('init')
    expect(sent(0)).toBe('keep it under five lines')
    await drain()
    // With nothing after it, nothing is the message.
    const bareReview = await service.start('/review', 'opencode', 'ask', { model: 'opencode/nemotron-3-ultra-free' }, () => undefined, undefined, PEER, undefined, undefined, undefined, true)
    expect(bareReview.ok, JSON.stringify(bareReview)).toBe(true)
    await drain()
    expect(argv(1)[argv(1).indexOf('--command') + 1]).toBe('review')
    expect(sent(1)).toBe('')
    await drain()
    // Not typed as a command: an ordinary briefed run.
    await service.start('/init', 'opencode', 'ask', { model: 'opencode/nemotron-3-ultra-free' }, () => undefined, undefined, PEER)
    expect(argv(2)).not.toContain('--command')
    expect(sent(2)).toContain(ROSTER_RULE)
  })
})
