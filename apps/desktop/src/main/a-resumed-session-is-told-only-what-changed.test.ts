import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type {
  NormalizedRuntimeEvent,
  RuntimeDiscovery,
  RuntimeProcessCompletion,
  RuntimeProcessRecordStream,
  RuntimeProcessRun
} from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memorySection } from '../shared/memory.js'
import { briefHeld, briefPlan, compactedDuring, createBriefSessions, FULL_BRIEF_EVERY } from './brief-sessions.js'
import { createCodexMissionService } from './codex-mission.js'
import { composeRuntimePrompt, composeSoloPrompt, paragraphKey } from './workroom-briefing.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A2.5: A CLI SESSION IS BRIEFED ONCE, THEN TOLD WHAT CHANGED.
 *
 * Every resumed turn used to carry the whole standing brief -- up to about
 * 12,000 characters -- into a session already holding a copy from each turn
 * before it (harness review, 2026-09-24, defect 5).
 */
const NOW = '2026-09-24T15:00:00.000Z'
const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
const NOVA = { teammateId: 'tm_nova', name: 'Nova', role: 'Docs & QA' }
const PEER: MissionPeerContext = { self: WREN, others: [ATLAS] }
const ROSTER_RULE = 'Writing a teammate\'s name in your reply does NOT reach them.'
const MEMORY_RULE = 'These are notes your team wrote earlier'
const STILL_HOLDS = 'You were given standing instructions earlier in this conversation'

const memory = (texts: readonly string[]): string =>
  memorySection({
    workspaceName: 'shop',
    memories: texts.map((text, index) => ({ id: `m${String(index)}`, text, scope: 'workspace' as const, by: 'Wren', where: undefined, at: NOW })),
    askFirst: false,
    selfName: 'Wren',
    now: new Date(NOW)
  })

function waiting(text: string): WorkroomMessage {
  return {
    messageId: 'wm_1',
    sequence: 1,
    from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
    to: { teammateId: 'tm_wren', name: 'Wren' },
    text,
    postedAt: NOW
  }
}

describe('the brief a resumed session is sent', () => {
  const first = composeRuntimePrompt({ prompt: 'Look around.', peer: PEER, inbound: [], remaining: 0, memory: memory(['The build is pnpm check.']) })

  it('is the whole brief on the first turn, and says which paragraphs it stands on', () => {
    expect(first.prompt).toContain(ROSTER_RULE)
    expect(first.prompt).toContain(MEMORY_RULE)
    expect(first.prompt).not.toContain(STILL_HOLDS)
    expect(first.given.length).toBeGreaterThan(5)
    // Keys of the paragraphs themselves: the same words give the same key.
    expect(first.given).toContain(paragraphKey(first.prompt.split('\n\n')[0]!))
  })

  it('is only what the session was not given on a later turn, after one line that says the rest holds', () => {
    const second = composeRuntimePrompt({
      prompt: 'And the tests?',
      peer: PEER,
      inbound: [waiting('pnpm check also lints.')],
      remaining: 0,
      memory: memory(['The build is pnpm check.']),
      alreadyGiven: new Set(first.given)
    })
    expect(second.prompt.startsWith(STILL_HOLDS)).toBe(true)
    // The tags are named, so a runtime that quietly started fresh can still answer.
    for (const tag of ['<locust-share to="Name">', '<locust-ask>', '<locust-file>', '<locust-memory>']) {
      expect(second.prompt).toContain(tag)
    }
    expect(second.prompt).not.toContain(ROSTER_RULE)
    expect(second.prompt).not.toContain(MEMORY_RULE)
    // What arrived this turn and what the person said always go.
    expect(second.prompt).toContain('pnpm check also lints.')
    expect(second.prompt.endsWith('And the tests?')).toBe(true)
    expect(second.prompt.length).toBeLessThan(first.prompt.length / 4)
    expect(second.given).toEqual(first.given)
  })

  it('sends again the paragraph that changed, and only that one', () => {
    // A memory was added: its listing moves, the rules for memory do not.
    const moved = composeRuntimePrompt({
      prompt: 'Go on.',
      peer: PEER,
      inbound: [],
      remaining: 0,
      memory: memory(['The build is pnpm check.', 'Releases go out on Fridays.']),
      alreadyGiven: new Set(first.given)
    })
    expect(moved.prompt).toContain('Releases go out on Fridays.')
    expect(moved.prompt).not.toContain(MEMORY_RULE)
    expect(moved.prompt).not.toContain(ROSTER_RULE)
    // A teammate joined: the roster is sent again, with its rules.
    const joined = composeRuntimePrompt({
      prompt: 'Go on.',
      peer: { self: WREN, others: [ATLAS, NOVA] },
      inbound: [],
      remaining: 0,
      memory: memory(['The build is pnpm check.']),
      alreadyGiven: new Set(first.given)
    })
    expect(joined.prompt).toContain('Atlas (Research & Briefs), Nova (Docs & QA).')
    expect(joined.prompt).not.toContain(MEMORY_RULE)
  })

  it('is the whole brief, word for word, when the session holds none of it', () => {
    const cold = composeRuntimePrompt({ prompt: 'Look around.', peer: PEER, inbound: [], remaining: 0, memory: memory(['The build is pnpm check.']), alreadyGiven: new Set() })
    expect(cold.prompt).toBe(first.prompt)
  })

  it('works the same for a run that belongs to nobody', () => {
    const solo = composeSoloPrompt({ prompt: 'Look around.', keepATodoList: false, memory: memory(['The build is pnpm check.']) })
    const later = composeSoloPrompt({ prompt: 'More?', keepATodoList: false, memory: memory(['The build is pnpm check.']), alreadyGiven: new Set(solo.given) })
    expect(later.prompt.startsWith(STILL_HOLDS)).toBe(true)
    expect(later.prompt).not.toContain('locust-share')
    expect(later.prompt).toContain('<locust-ask>')
    expect(later.prompt).not.toContain(MEMORY_RULE)
    expect(later.prompt.endsWith('More?')).toBe(true)
  })
})

describe('what a session is recorded as holding', () => {
  const record = { given: ['aaaaaaaaaaaaaaaa'], turns: 0 }

  it('is trusted only for a turn that resumes a session that did not compact', () => {
    expect(briefPlan({ resumes: false, compacted: false, earlier: record }).alreadyGiven).toBeUndefined()
    expect(briefPlan({ resumes: true, compacted: true, earlier: record }).alreadyGiven).toBeUndefined()
    expect(briefPlan({ resumes: true, compacted: false, earlier: undefined }).alreadyGiven).toBeUndefined()
    expect(briefPlan({ resumes: true, compacted: false, earlier: record })).toEqual({ alreadyGiven: new Set(record.given), turns: 1 })
  })

  it('is set aside every few turns regardless, so the whole brief comes back', () => {
    expect(briefPlan({ resumes: true, compacted: false, earlier: { ...record, turns: FULL_BRIEF_EVERY - 2 } }).alreadyGiven).toBeDefined()
    expect(briefPlan({ resumes: true, compacted: false, earlier: { ...record, turns: FULL_BRIEF_EVERY - 1 } })).toEqual({ turns: 0 })
  })

  it('keeps what the session held, with this brief\'s paragraphs newest', () => {
    expect(briefHeld(new Set(['a', 'b']), ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(briefHeld(undefined, ['c'])).toEqual(['c'])
  })

  it('reads a compaction from any runtime that reports one', () => {
    const diagnostic = (code: string) => ({ type: 'adapter.diagnostic', payload: { code, level: 'info', message: 'x', terminal: false } }) as unknown as NormalizedRuntimeEvent
    expect(compactedDuring([diagnostic('opencode.context_compacted')])).toBe(true)
    expect(compactedDuring([diagnostic('claude.context_compacted')])).toBe(true)
    expect(compactedDuring([diagnostic('opencode.unknown_event')])).toBe(false)
  })
})

describe('the record on disk', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-brief-sessions-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  it('is read back by the next start of the app', async () => {
    await createBriefSessions({ rootDirectory: folder }).record('mission_1', { given: ['0123456789abcdef'], turns: 2 })
    expect(await createBriefSessions({ rootDirectory: folder }).after('mission_1')).toEqual({ given: ['0123456789abcdef'], turns: 2 })
    expect(await createBriefSessions({ rootDirectory: folder }).after('mission_2')).toBeUndefined()
  })

  it('is no record at all when it cannot be read, so the turn is briefed in full', async () => {
    await writeFile(join(folder, 'brief-sessions.json'), '{ not json', 'utf8')
    expect(await createBriefSessions({ rootDirectory: folder }).after('mission_1')).toBeUndefined()
    await writeFile(join(folder, 'brief-sessions.json'), JSON.stringify({ version: 1, sessions: { mission_1: { given: ['not a key'], turns: 0, at: NOW } } }), 'utf8')
    expect(await createBriefSessions({ rootDirectory: folder }).after('mission_1')).toBeUndefined()
  })
})

describe('a conversation with a teammate, through the mission service', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-brief-service-'))
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
  /** The turn a follow-up continues, as the ledger gives it back. */
  const prior = (missionId: string, compacted: boolean) => ({
    metadata: {
      missionId,
      runId: 'run_prior',
      prompt: 'earlier',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: null,
      workspaceId: 'ws_test',
      sandbox: 'read-only',
      mode: 'ask',
      executionPolicyVersion: 1,
      createdAt: NOW
    },
    events: [
      { id: 'e1', runId: 'run_prior', missionId, sequence: 1, type: 'run.started', occurredAt: NOW, sourceAdapter: 'codex', payload: { runtimeThreadId: 'thread-1', evidence: { redacted: true } } },
      ...(compacted
        ? [{ id: 'e2', runId: 'run_prior', missionId, sequence: 2, type: 'adapter.diagnostic', occurredAt: NOW, sourceAdapter: 'codex', payload: { code: 'codex.context_compacted', level: 'info', message: 'x', terminal: false, evidence: { redacted: true } } }]
        : [])
    ],
    hostFailures: [],
    checkpoints: [],
    peerLinks: [],
    phase: 'completed',
    lastUpdatedAt: NOW,
    ledgerSequence: 2,
    issues: []
  })

  it('briefs a resumed turn with what changed, and in full again after the session compacted', async () => {
    const compactedMissions = new Set<string>()
    const ledger = {
      createMission: async () => undefined,
      appendEvents: async () => undefined,
      appendHostFailure: async () => undefined,
      createCheckpoint: async () => {
        throw new Error('not used')
      },
      appendPeerLinks: async () => undefined,
      deleteMission: async () => true,
      listTrashedMissions: async () => [],
      restoreMission: async () => true,
      emptyTrash: async () => 0,
      storageReport: async () => ({ missionCount: 0, byteTotal: 0, unreadableCount: 0 }),
      pruneMissions: async () => ({ deleted: [], failed: [], unreadable: [], keptForContinuity: [], keptAsRunning: [] }),
      getMission: async (missionId: string) => prior(missionId, compactedMissions.has(missionId)),
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const start = vi.fn((_spec, _prompt, _options): RuntimeProcessRun => ({
      records: stream([{ type: 'thread.started', thread_id: 'thread-1' }, { type: 'turn.completed' }]),
      completion: Promise.resolve(completion())
    }))
    const scheduled: Array<() => void> = []
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace',
      discover: async () => [runtime],
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

    const one = await service.start('First.', 'codex', 'ask', {}, () => undefined, undefined, PEER)
    expect(one.ok).toBe(true)
    if (!one.ok) return
    await drain()
    const two = await service.start('Second.', 'codex', 'ask', {}, () => undefined, undefined, PEER, one.data.missionId)
    expect(two.ok).toBe(true)
    if (!two.ok) return
    await drain()
    compactedMissions.add(two.data.missionId)
    const three = await service.start('Third.', 'codex', 'ask', {}, () => undefined, undefined, PEER, two.data.missionId)
    expect(three.ok).toBe(true)

    expect(sent(0)).toContain(ROSTER_RULE)
    // Resumed, not compacted: the line, not the rules.
    expect(sent(1)).toContain(STILL_HOLDS)
    expect(sent(1)).not.toContain(ROSTER_RULE)
    expect(sent(1).endsWith('Second.')).toBe(true)
    // The session summarized itself during turn two: the whole brief again.
    expect(sent(2)).toContain(ROSTER_RULE)
    expect(sent(2)).not.toContain(STILL_HOLDS)
  })
})
