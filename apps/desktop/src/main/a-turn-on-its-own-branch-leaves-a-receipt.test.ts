import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MissionLedger, Workroom } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent, RuntimeDiscovery, RuntimeProcessCompletion, RuntimeProcessRecordStream, RuntimeProcessRun } from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBriefSessions } from './brief-sessions.js'
import { createCodexMissionService } from './codex-mission.js'
import { CHECKPOINT_CODE, checkpointMessage, checkpointSentence } from './turn-checkpoint.js'
import type { MissionPeerContext } from './workroom-briefing.js'
import type { CheckpointResult } from './worktrees.js'

/**
 * A TURN ON ITS OWN BRANCH IS COMMITTED, WITH A RECEIPT (0.439).
 *
 * Idea #2 of PRODUCT-SUGGESTIONS-2026-09-28, which Colin picked: when a turn
 * ends for a teammate with Own branch on, the host commits what changed to
 * its branch and says so in the mission's own stream -- recorded before it
 * is shown. A run in the shared folder is never committed: that folder is
 * the person's checkout.
 */
const NOW = '2026-09-28T15:00:00.000Z'
const WORKTREE = process.platform === 'win32' ? 'C:\\project\\.locust\\worktrees\\tm_wren' : '/project/.locust/worktrees/tm_wren'
const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project'
const self = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const ON_ITS_BRANCH: MissionPeerContext = { self, others: [], cwd: WORKTREE, repositoryRoot: ROOT }
const IN_THE_FOLDER: MissionPeerContext = { self, others: [] }
type CheckpointInput = Parameters<NonNullable<Parameters<typeof createCodexMissionService>[0]['checkpointTurn']>>[0]

describe('a turn on its own branch', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-turn-checkpoint-'))
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
    exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, cancelled: false,
    forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false,
    outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: NOW, finishedAt: NOW
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

  const setUp = (checkpoint: () => Promise<CheckpointResult>) => {
    const appended: NormalizedRuntimeEvent[] = []
    const ledger = {
      createMission: async () => undefined,
      appendEvents: async (_id: string, events: readonly NormalizedRuntimeEvent[]) => {
        appended.push(...events)
      },
      appendHostFailure: async () => undefined,
      appendPeerLinks: async () => undefined,
      appendEditCheck: async () => undefined, appendApproval: async () => undefined,
      getMission: async () => undefined,
      listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
      flush: async () => undefined
    } as unknown as MissionLedger
    const start = vi.fn((): RuntimeProcessRun => ({
      records: stream([
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Fixed the total.\nIt summed twice.' } },
        { type: 'turn.completed' }
      ]),
      completion: Promise.resolve(completion())
    }))
    const checkpointTurn = vi.fn((_input: CheckpointInput) => checkpoint())
    const scheduled: Array<() => void> = []
    let nextId = 0
    const service = createCodexMissionService({
      workspacePath: ROOT,
      discover: async () => [runtime],
      runner: { start },
      ledger,
      workroom,
      briefSessions: createBriefSessions({ rootDirectory: folder }),
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: (task) => scheduled.push(task),
      checkpointTurn
    })
    const drain = async (): Promise<void> => {
      while (scheduled.length > 0) scheduled.shift()!()
      for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve))
    }
    const notices = () => appended.filter((event) => event.type === 'adapter.diagnostic' && (event.payload as { code: string }).code === CHECKPOINT_CODE)
    return { service, drain, checkpointTurn, notices }
  }

  const committed = async (): Promise<CheckpointResult> => ({ kind: 'committed', sha: '0123456789abcdef0123456789abcdef01234567', branch: 'locust/wren', files: ['cart.py', 'cart_test.py'], skipped: [] })

  it('is committed to its branch when it ends, and the receipt is recorded in its stream', async () => {
    const { service, drain, checkpointTurn, notices } = setUp(committed)
    const started = await service.start('Fix the cart total\nit doubles', 'codex', 'accept-edits', {}, () => undefined, undefined, ON_ITS_BRANCH)
    expect(started.ok).toBe(true)
    await drain()
    expect(checkpointTurn).toHaveBeenCalledTimes(1)
    const input = checkpointTurn.mock.calls[0]![0]
    expect(input.repositoryRoot).toBe(ROOT)
    expect(input.teammateId).toBe('tm_wren')
    expect(input.message.subject).toBe('Fix the cart total')
    expect(input.message.body).toBe('Fixed the total.')
    expect(input.message.trailers).toContainEqual(['Locust-Turn', 'completed'])
    expect(input.message.author).toEqual({ name: 'Wren', email: 'tm_wren@teammates.locust' })
    expect(notices()).toHaveLength(1)
    expect((notices()[0]!.payload as { message: string }).message).toBe('Saved this turn on locust/wren as 0123456789ab: 2 files (cart.py, cart_test.py).')
  })

  it('is never committed when it ran in the shared folder, the person\'s own checkout', async () => {
    const { service, drain, checkpointTurn, notices } = setUp(committed)
    await service.start('Fix it', 'codex', 'accept-edits', {}, () => undefined, undefined, IN_THE_FOLDER)
    await drain()
    expect(checkpointTurn).not.toHaveBeenCalled()
    expect(notices()).toHaveLength(0)
  })

  it('is never committed from a slot of its own -- a comparison\'s column, a judge, a side question (0.532)', async () => {
    // A column for a teammate with Own branch carried its context, and its end
    // committed the teammate's branch with the comparison's ask, sweeping in a
    // direct run's half-done edits there.
    const { service, drain, checkpointTurn, notices } = setUp(committed)
    const started = await service.start('Which CRM?', 'codex', 'accept-edits', {}, () => undefined, undefined, ON_ITS_BRANCH, undefined, undefined, undefined, undefined, { key: 'compare:tm_wren:cmp_1:a', cwd: ROOT })
    expect(started.ok).toBe(true)
    await drain()
    expect(checkpointTurn).not.toHaveBeenCalled()
    expect(notices()).toHaveLength(0)
  })

  it('says nothing when the turn changed nothing', async () => {
    const { service, drain, notices } = setUp(async () => ({ kind: 'clean' }))
    await service.start('Just look', 'codex', 'accept-edits', {}, () => undefined, undefined, ON_ITS_BRANCH)
    await drain()
    expect(notices()).toHaveLength(0)
  })

  it('says so, as a warning, when the commit could not be made -- and the files stay', async () => {
    const { service, drain, notices } = setUp(async () => {
      throw new Error('git commit: index.lock exists.')
    })
    await service.start('Fix it', 'codex', 'accept-edits', {}, () => undefined, undefined, ON_ITS_BRANCH)
    await drain()
    expect(notices()).toHaveLength(1)
    expect((notices()[0]!.payload as { level: string; message: string }).level).toBe('warning')
    expect((notices()[0]!.payload as { message: string }).message).toContain('index.lock exists. They are still in its folder.')
  })
})

describe('the message and the sentence', () => {
  it('takes the person\'s words from a routine step or a tag, not the host text around them', () => {
    const base = { answer: undefined, teammate: { teammateId: 'tm_wren', name: 'Wren' }, missionId: 'm_1', runtime: 'codex', model: 'gpt-6-luna', outcome: 'stopped' as const }
    expect(checkpointMessage({ ...base, prompt: 'Wren did the step before this one and answered:\n\nstuff\n\nYour step: Write the plan.' }).subject).toBe('Write the plan.')
    expect(checkpointMessage({ ...base, prompt: 'Check the rate.\n\n(You were tagged in Atlas\'s conversation.)' }).subject).toBe('Check the rate.')
    expect(checkpointMessage({ ...base, prompt: 'x'.repeat(200) }).subject.length).toBeLessThanOrEqual(72)
    expect(checkpointMessage({ ...base, prompt: '   ' }).subject).toBe("Wren's turn")
    expect(checkpointMessage({ ...base, prompt: 'Go' }).trailers).toContainEqual(['Locust-Route', 'codex / gpt-6-luna'])
  })

  it('makes a subject of the first sentence, or cuts at a word -- never mid-word', () => {
    const base = { answer: undefined, teammate: { teammateId: 'tm_wren', name: 'Wren' }, missionId: 'm_1', runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', outcome: 'completed' as const }
    // The first landing drive's subject: "... Change nothing el…".
    expect(checkpointMessage({ ...base, prompt: 'In cart.py, change `return 0` to `return sum(items)`. Change nothing else and do not run anything.' }).subject)
      .toBe('In cart.py, change `return 0` to `return sum(items)`.')
    const long = checkpointMessage({ ...base, prompt: 'Rename every helper in the billing module so that each name says what it returns and not how' }).subject
    expect(long.length).toBeLessThanOrEqual(72)
    expect(long.endsWith(' …')).toBe(false)
    expect(long).toMatch(/ [a-z]+…$/)
    // And the route names the runtime once.
    expect(checkpointMessage({ ...base, prompt: 'Go' }).trailers).toContainEqual(['Locust-Route', 'opencode / nemotron-3-ultra-free'])
  })

  it('names what was left out for being too big', () => {
    expect(checkpointSentence({ kind: 'skipped', skipped: [{ path: 'data.bin', bytes: 80 * 1024 * 1024 }] })).toBe('Nothing from this turn was saved on the branch. Left out, too big to commit: data.bin (80 MB).')
    expect(checkpointSentence({ kind: 'committed', sha: 'a'.repeat(40), branch: 'locust/wren', files: ['a', 'b', 'c', 'd', 'e'], skipped: [] })).toBe(`Saved this turn on locust/wren as ${'a'.repeat(12)}: 5 files (a, b, c and 2 more).`)
  })
})
