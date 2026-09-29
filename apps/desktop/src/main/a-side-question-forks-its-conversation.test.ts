import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MissionLedger, Workroom } from '@teammate/mission-store'
import type { RuntimeDiscovery, RuntimeProcessCompletion, RuntimeProcessRecordStream, RuntimeProcessRun } from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBriefSessions } from './brief-sessions.js'
import { createCodexMissionService, SIDE_QUESTION_PREFACE } from './codex-mission.js'

/**
 * A QUESTION ON THE SIDE IS ASKED OF A COPY (0.461, Devin's side chats).
 *
 * Asked while the conversation works, of a FORK of its session: read-only, on
 * its own runtime, recorded as `side` -- never as the conversation's next
 * turn -- and refused wherever a copy cannot be made, rather than asked of the
 * conversation itself.
 */
const NOW = '2026-09-29T15:00:00.000Z'

describe('a question on the side', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-side-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const claude: RuntimeDiscovery = {
    id: 'claude',
    kind: 'agent-runtime',
    displayName: 'Claude Code',
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: {
      commandName: 'claude',
      discoveredPath: process.platform === 'win32' ? 'C:\\tools\\claude.exe' : '/tools/claude',
      executablePath: process.platform === 'win32' ? 'C:\\tools\\claude.exe' : '/tools/claude',
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: '2.1.283 (Claude Code)', version: '2.1.283', major: 2, minor: 1, patch: 283 },
    supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
    diagnostics: []
  }
  const open = (): RuntimeProcessRun => ({
    records: {
      async *[Symbol.asyncIterator]() {
        yield { sequence: 1, raw: JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-2' }) }
      },
      drainAvailable: () => []
    } as RuntimeProcessRecordStream,
    completion: new Promise<RuntimeProcessCompletion>(() => undefined)
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

  /** One conversation turn, `mission_convo`, on `runtime`, whose session is `session` (or none). */
  const service = (runtime: string, session: string | undefined, resumed?: string) => {
    const spawned: { args: readonly string[]; prompt: string }[] = []
    const recorded: Record<string, unknown>[] = []
    let nextId = 0
    const missions = createCodexMissionService({
      workspacePath: folder,
      discover: async () => [claude],
      runner: {
        start: (spec: { readonly args: readonly string[] }, prompt: string) => {
          spawned.push({ args: spec.args, prompt })
          return open()
        }
      },
      ledger: {
        createMission: async (input: Record<string, unknown>) => {
          recorded.push(input)
        },
        appendEvents: async () => undefined,
        appendHostFailure: async () => undefined,
        appendPeerLinks: async () => undefined,
        appendEditCheck: async () => undefined,
        getMission: async (missionId: string) =>
          missionId === 'mission_convo'
            ? {
                metadata: {
                  missionId, runId: 'run_convo', runtime, model: 'account-default', mode: 'accept-edits', createdAt: NOW,
                  ...(resumed === undefined ? {} : { continuesFrom: { missionId: 'mission_before', checkpointEpoch: 1, reason: 'follow-up', runtimeThreadId: resumed } })
                },
                phase: 'running',
                events: session === undefined ? [] : [{ type: 'run.started', payload: { runtimeThreadId: session } }]
              }
            : undefined,
        listMissions: async () => ({ missions: [], issues: [], unreadableCount: 0 }),
        flush: async () => undefined
      } as unknown as MissionLedger,
      workroom,
      briefSessions: createBriefSessions({ rootDirectory: folder }),
      createId: () => String(++nextId),
      now: () => new Date(NOW),
      schedule: () => undefined
    })
    const ask = (mode: 'ask' | 'accept-edits' = 'ask', on: string = runtime) =>
      missions.start('Why did you pick that library?', on as 'claude', mode, {}, () => undefined, undefined, undefined, undefined, undefined, undefined, undefined, { key: 'side:mission_convo' }, { of: 'mission_convo', question: 1 })
    return { spawned, recorded, ask }
  }

  it('forks the conversation\'s session, read-only, and is recorded as a side question, not its next turn', async () => {
    const { spawned, recorded, ask } = service('claude', 'sess-1')
    const started = await ask()
    expect(started.ok).toBe(true)
    const args = spawned[0]!.args
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 3)).toEqual(['--resume', 'sess-1', '--fork-session'])
    expect(recorded[0]?.startedBy).toEqual({ kind: 'side', of: 'mission_convo', question: 1 })
    expect(recorded[0]).not.toHaveProperty('continuesFrom')
    expect(recorded[0]?.sandbox).toBe('read-only')
  })

  it('is told only what it is: the copy holds the brief and the conversation already', () => {
    expect(SIDE_QUESTION_PREFACE).toMatch(/copy of this conversation/)
    expect(SIDE_QUESTION_PREFACE).toMatch(/Change nothing/)
  })

  it('copies the session a turn still running resumed, before it has said its own', async () => {
    // drive-side-chat, 0.461: asked mid-turn, the running turn named no session yet.
    const { spawned, ask } = service('claude', undefined, 'sess-0')
    expect((await ask()).ok).toBe(true)
    const args = spawned[0]!.args
    expect(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 3)).toEqual(['--resume', 'sess-0', '--fork-session'])
  })

  it('is refused, not asked of the conversation, when there is no session to copy', async () => {
    const { spawned, ask } = service('claude', undefined)
    const started = await ask()
    expect(started.ok).toBe(false)
    if (!started.ok) expect(started.error.message).toMatch(/no session to ask about yet/)
    expect(spawned).toEqual([])
  })

  it('is only ever read-only', async () => {
    const { spawned, ask } = service('claude', 'sess-1')
    const started = await ask('accept-edits')
    expect(started.ok).toBe(false)
    expect(spawned).toEqual([])
  })

  it('is refused on a runtime that cannot copy a session', async () => {
    const { spawned, ask } = service('cursor', 'sess-1')
    const started = await ask('ask', 'cursor')
    // Refused before anything runs, whichever check says so first.
    expect(started.ok).toBe(false)
    expect(spawned).toEqual([])
  })
})
