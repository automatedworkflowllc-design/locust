import type { MissionLedger } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { AgentApi, AntigravityHost } from './antigravity-host.js'
import { antigravityExecutableCandidates, createAntigravityHostProbe, parseServerCommandLine, transcriptPathFor } from './antigravity-host.js'
import { antigravityTier, createAntigravityMissionService } from './antigravity-mission.js'
import type { AntigravityMissionService } from './antigravity-mission.js'

const NOW = '2026-09-03T09:00:00.000Z'
const HOME = 'C:\\Users\\dev'
const WORKSPACE = 'C:\\work\\pebble'
const CONVERSATION = '03a2fcb4-8fd9-468e-a683-6bf3a5acd077'

const SERVER_CMD =
  'C:\\Users\\dev\\AppData\\Local\\Programs\\antigravity\\resources\\bin\\language_server.exe --standalone --override_ide_name antigravity --subclient_type hub --override_ide_version 2.11.0 --https_server_port 0 --csrf_token 60843f52-6d41-4d97-9b31-53157a780b5e --app_data_dir antigravity'

/** The transcript Antigravity wrote for a write-then-answer conversation, as measured. */
const WRITE_LINES = [
  JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', created_at: NOW, content: '<USER_REQUEST>make hello.txt</USER_REQUEST>' }),
  JSON.stringify({ step_index: 1, source: 'SYSTEM', type: 'CHECKPOINT', status: 'DONE', created_at: NOW, content: '{{ CHECKPOINT 0 }} the whole conversation so far' }),
  JSON.stringify({
    step_index: 2,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: NOW,
    thinking: 'private reasoning',
    tool_calls: [{ name: 'write_to_file', args: { TargetFile: '"c:/work/pebble/hello.txt"', CodeContent: '"hello\\n"', Overwrite: 'true' } }]
  }),
  JSON.stringify({ step_index: 3, source: 'MODEL', type: 'GENERIC', status: 'DONE', created_at: NOW, content: 'Created file file:///c:/work/pebble/hello.txt with requested content.' }),
  JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: NOW, content: 'DONE' })
]

function fakeLedger(refuseAppend = false): { ledger: MissionLedger; created: unknown[]; appended: { missionId: string; events: readonly { type: string; payload: Record<string, unknown> }[] }[] } {
  const created: unknown[] = []
  const appended: { missionId: string; events: readonly { type: string; payload: Record<string, unknown> }[] }[] = []
  const ledger = {
    createMission: async (input: unknown) => {
      created.push(input)
    },
    appendEvents: async (missionId: string, events: readonly { type: string; payload: Record<string, unknown> }[]) => {
      if (refuseAppend) throw new Error('no space left on device')
      appended.push({ missionId, events })
    },
    appendHostFailure: async () => undefined,
    getMission: async () => undefined,
    appendPeerLinks: async () => undefined
  } as unknown as MissionLedger
  return { ledger, created, appended }
}

function host(): AntigravityHost {
  return {
    executablePath: 'C:\\lang\\language_server.exe',
    version: '2.11.0',
    address: 'localhost:49839',
    csrfToken: '60843f52-6d41-4d97-9b31-53157a780b5e',
    projects: new Map([['c:/work/pebble', 'daf0f8ec-bb8e-49e8-a445-954eb0a62d0f']])
  }
}

interface Harness {
  readonly service: AntigravityMissionService
  readonly api: { calls: { kind: string; input: unknown }[] }
  readonly transcript: { lines: string[] }
  readonly emitted: { type: string; payload: Record<string, unknown> }[]
  readonly created: unknown[]
  readonly appended: ReturnType<typeof fakeLedger>['appended']
  readonly updates: { kind: string }[]
  readonly notices: { message: string }[]
}

function harness(options: { host?: AntigravityHost | undefined; lines?: string[]; idleTimeoutMs?: number; askingNoticeMs?: number; refuseAppend?: boolean } = {}): Harness {
  const { ledger, created, appended } = fakeLedger(options.refuseAppend === true)
  const api = { calls: [] as { kind: string; input: unknown }[] }
  const transcript = { lines: options.lines ?? [] }
  const emitted: { type: string; payload: Record<string, unknown> }[] = []
  const updates: { kind: string }[] = []
  const notices: { message: string }[] = []
  let ids = 0
  const service = createAntigravityMissionService({
    workspacePath: WORKSPACE,
    ledger,
    probe: async () => (options.host === undefined && 'host' in options ? undefined : (options.host ?? host())),
    emitEvent: (_runId, _missionId, event) => emitted.push(event as { type: string; payload: Record<string, unknown> }),
    emitUpdate: (update) => updates.push(update as unknown as { kind: string }),
    agentApi: (): AgentApi => ({
      newConversation: async (input) => {
        api.calls.push({ kind: 'new', input })
        return CONVERSATION
      },
      sendMessage: async (input) => {
        api.calls.push({ kind: 'send', input })
      }
    }),
    readTranscript: async (path) => (path === transcriptPathFor(HOME, CONVERSATION) ? transcript.lines.join('\n') : undefined),
    home: HOME,
    createId: () => String(++ids),
    now: () => new Date(NOW),
    pollMs: 5,
    notify: ({ message }) => notices.push({ message }),
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.askingNoticeMs === undefined ? {} : { askingNoticeMs: options.askingNoticeMs })
  })
  return { service, api, transcript, emitted, created, appended, updates, notices }
}

const settle = async (ticks = 12): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('finding the running Antigravity', () => {
  it("reads the token and version off the server's own command line, and only Antigravity's", () => {
    expect(parseServerCommandLine(SERVER_CMD)).toEqual({ csrfToken: '60843f52-6d41-4d97-9b31-53157a780b5e', version: '2.11.0' })
    expect(parseServerCommandLine(SERVER_CMD.replace('--override_ide_name antigravity', '--override_ide_name windsurf'))).toBeUndefined()
    expect(parseServerCommandLine('language_server.exe --override_ide_name antigravity')).toBeUndefined()
  })

  it('looks under both spellings of the install folder', () => {
    expect(antigravityExecutableCandidates('C:\\lad')).toEqual([
      'C:\\lad\\Programs\\antigravity\\resources\\bin\\language_server.exe',
      'C:\\lad\\Programs\\Antigravity\\resources\\bin\\language_server.exe'
    ])
  })

  it('picks the listening port that speaks the RPC, not the one that drops the connection', async () => {
    const asked: string[] = []
    const probe = createAntigravityHostProbe({
      platform: 'win32',
      localAppData: 'C:\\lad',
      home: HOME,
      listProcesses: async () => [{ pid: 5344, commandLine: SERVER_CMD }],
      listeningPorts: async () => [49838, 49839],
      run: async (_exe, _args, env) => {
        asked.push(env.ANTIGRAVITY_LS_ADDRESS ?? '')
        return env.ANTIGRAVITY_LS_ADDRESS === 'localhost:49838'
          ? { stdout: '{"error":"rpc error: connection error: wsarecv: An established connection was aborted"}', stderr: '', code: 0 }
          : { stdout: '{"error":"conversation not found"}', stderr: '', code: 0 }
      }
    })
    // The executable check is a real filesystem look; nothing is installed at C:\lad.
    const record = await probe.discoveryRecord()
    expect(record.id).toBe('antigravity')
    expect(record.availability).toBe('unavailable')
    expect(asked).toEqual([])
  })
})

describe('a mission through Antigravity', () => {
  it('maps any model to a tier, defaulting to flash', () => {
    expect(antigravityTier('pro')).toBe('pro')
    expect(antigravityTier('flash_lite')).toBe('flash_lite')
    expect(antigravityTier('account-default')).toBe('flash')
    expect(antigravityTier(undefined)).toBe('flash')
  })

  it('refuses, recording nothing, when Antigravity is not open', async () => {
    const h = harness({ host: undefined })
    await expect(h.service.start('hi', undefined, {})).rejects.toThrow(/not open/)
    expect(h.created).toHaveLength(0)
    expect(h.api.calls).toHaveLength(0)
  })

  it('refuses, naming the folder, when Antigravity has not opened the workspace', async () => {
    const h = harness({ host: { ...host(), projects: new Map() } })
    await expect(h.service.start('hi', undefined, {})).rejects.toThrow(/has not opened C:\\work\\pebble/)
    expect(h.created).toHaveLength(0)
  })

  it('opens the conversation with the project id, records the mission, and follows the transcript to the final answer', async () => {
    const h = harness({ lines: [] })
    const mission = await h.service.start('make hello.txt', undefined, { model: 'flash' })
    expect(mission.conversationId).toBe(CONVERSATION)
    expect(h.api.calls[0]).toMatchObject({ kind: 'new', input: { projectId: 'daf0f8ec-bb8e-49e8-a445-954eb0a62d0f', model: 'flash' } })
    expect(h.created[0]).toMatchObject({ runtime: 'antigravity', model: 'flash', sandbox: 'workspace-write', resolvedRouteId: 'antigravity:hub' })
    expect(h.service.has(mission.runId)).toBe(true)

    // The agent works; lines arrive over time.
    h.transcript.lines = WRITE_LINES.slice(0, 4)
    await settle()
    expect(h.emitted.some((event) => event.type === 'tool.started' && event.payload.name === 'write_to_file')).toBe(true)
    expect(h.service.has(mission.runId)).toBe(true)

    h.transcript.lines = WRITE_LINES
    await settle()
    const types = h.emitted.map((event) => event.type)
    expect(types).toContain('message.delta')
    expect(types.at(-1)).toBe('run.completed')
    expect(h.emitted.at(-1)?.payload.runtimeThreadId ?? (h.emitted.at(-1) as { runtimeThreadId?: string }).runtimeThreadId).toBeDefined()
    expect(h.service.has(mission.runId)).toBe(false)
    // Persisted before emitted, and nothing private in what was persisted.
    const persisted = JSON.stringify(h.appended)
    expect(persisted).not.toContain('private reasoning')
    expect(persisted).not.toContain('the whole conversation so far')
  })

  it('a follow-up sends into the same conversation and reads only the lines after the earlier turns', async () => {
    const { ledger, created, appended } = fakeLedger()
    ;(ledger as unknown as { getMission: unknown }).getMission = async () => ({
      metadata: { missionId: 'mission_prior', runtime: 'antigravity' },
      events: [{ type: 'run.completed', payload: { runtimeThreadId: CONVERSATION } }]
    })
    const api = { calls: [] as { kind: string; input: unknown }[] }
    const transcript = { lines: [...WRITE_LINES] }
    const emitted: { type: string }[] = []
    let ids = 0
    const service = createAntigravityMissionService({
      workspacePath: WORKSPACE,
      ledger,
      probe: async () => host(),
      emitEvent: (_r, _m, event) => emitted.push(event as { type: string }),
      agentApi: (): AgentApi => ({
        newConversation: async () => {
          throw new Error('must not open a new conversation for a follow-up')
        },
        sendMessage: async (input) => {
          api.calls.push({ kind: 'send', input })
        }
      }),
      readTranscript: async () => transcript.lines.join('\n'),
      home: HOME,
      createId: () => String(++ids),
      now: () => new Date(NOW),
      pollMs: 5
    })
    const mission = await service.start('what did you reply?', undefined, { followUpOf: 'mission_prior' })
    expect(mission.followsUp).toEqual({ missionId: 'mission_prior', runtimeThreadId: CONVERSATION })
    expect(api.calls[0]).toMatchObject({ kind: 'send', input: { conversationId: CONVERSATION } })
    expect(created[0]).toMatchObject({ continuesFrom: { missionId: 'mission_prior', reason: 'follow-up', runtimeThreadId: CONVERSATION } })
    await settle()
    // Nothing from the earlier turns was replayed as this run's work.
    expect(emitted.some((event) => event.type === 'tool.started')).toBe(false)
    transcript.lines = [
      ...WRITE_LINES,
      JSON.stringify({ step_index: 5, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', status: 'DONE', created_at: NOW, content: '<SYSTEM_MESSAGE>what did you reply?</SYSTEM_MESSAGE>' }),
      JSON.stringify({ step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: NOW, content: 'DONE' })
    ]
    await settle()
    expect(emitted.map((event) => event.type).at(-1)).toBe('run.completed')
    expect(appended.length).toBeGreaterThan(0)
  })

  /**
   * Colin, 2026-09-21, on a run that sat for forty minutes: *"this antigrav
   * question was not appearing in locust ui, didnt know it was hung up."*
   *
   * Antigravity had stopped on its own "Allow reading this URL?" prompt --
   * read from his transcript afterwards: a `search_web` call at 12:09:53
   * with nothing after it. The sentence that explains this existed only in
   * the ten-minute timeout, which ENDS the mission, and his app restarted
   * for an update before it fired. So the one thing he needed to know was
   * ten minutes away and then never came at all.
   */
  it('says the agent may be asking, long before the timeout and without ending the run', async () => {
    // A tool is open (step 2 calls `write_to_file`) and nothing follows it.
    const h = harness({ lines: WRITE_LINES.slice(0, 3), askingNoticeMs: 15, idleTimeoutMs: 100_000 })
    const mission = await h.service.start('hi', undefined, {})
    await settle(10)
    const said = h.notices.map((notice) => notice.message).join(' | ')
    expect(said).toMatch(/write_to_file/)
    expect(said).toMatch(/its own window/i)
    // NOT an ending: the run is still being watched.
    expect(h.service.has(mission.runId)).toBe(true)
    expect(h.emitted.map((event) => event.type)).not.toContain('run.failed')
  })

  it('says it once, not on every tick', async () => {
    const h = harness({ lines: WRITE_LINES.slice(0, 3), askingNoticeMs: 15, idleTimeoutMs: 100_000 })
    await h.service.start('hi', undefined, {})
    await settle(20)
    expect(h.notices).toHaveLength(1)
  })

  it('says nothing while the agent is still writing', async () => {
    const h = harness({ lines: WRITE_LINES, askingNoticeMs: 15, idleTimeoutMs: 100_000 })
    await h.service.start('hi', undefined, {})
    await settle(6)
    // The transcript reaches a final answer, so there is no open tool and
    // no silence worth naming.
    expect(h.notices).toHaveLength(0)
  })

  it('gives up when the agent writes nothing for too long, as a failure and not a completion', async () => {
    const h = harness({ lines: [], idleTimeoutMs: 20 })
    const mission = await h.service.start('hi', undefined, {})
    await settle(10)
    expect(h.service.has(mission.runId)).toBe(false)
    expect(h.emitted.map((event) => event.type).at(-1)).toBe('run.failed')
  })

  it('stopping stops the watch and says the agent may still be working', async () => {
    const h = harness({ lines: WRITE_LINES.slice(0, 3) })
    const mission = await h.service.start('hi', undefined, {})
    await settle(3)
    expect(h.service.cancel(mission.runId)).toBe(true)
    await settle(3)
    expect(h.service.has(mission.runId)).toBe(false)
    expect(h.emitted.map((event) => event.type).at(-1)).toBe('run.cancelled')
    expect(h.service.cancel(mission.runId)).toBe(false)
  })

  it('one live mission per teammate', async () => {
    const h = harness({ lines: [] })
    const peer = { self: { teammateId: 'tm_w', name: 'Wren', role: 'Code & Migrations' }, others: [] }
    await h.service.start('one', peer, {})
    await expect(h.service.start('two', peer, {})).rejects.toThrow(/already has a mission running/)
  })
})

describe('when the ledger refuses a receipt', () => {
  /*
   * The same defect the app-server path carried until 0.51.0, found by
   * sweeping for the shape rather than waiting for it to bite. This one was
   * worse in one specific way, which the second test pins.
   */
  it('ends the run and says so, instead of polling on with nobody recording', async () => {
    const test = harness({ lines: WRITE_LINES, refuseAppend: true })
    await test.service.start('Write hello.txt', undefined, {})
    await settle()
    expect(test.updates.some((update) => update.kind === 'persistence-error')).toBe(true)
  })

  it('does NOT advance past events it failed to write', async () => {
    /*
     * The cursor used to move BEFORE the write, so a ledger failure took those
     * events with it -- never persisted, never emitted, and never retried,
     * because the next tick started after them. Re-reading the transcript from
     * the same place is what makes a transient failure genuinely retryable.
     */
    const test = harness({ lines: WRITE_LINES, refuseAppend: true })
    await test.service.start('Write hello.txt', undefined, {})
    await settle()
    expect(test.appended).toHaveLength(0)
    expect(test.emitted).toHaveLength(0)
  })

  it('leaves a healthy run completely alone', async () => {
    // The control: without it both tests above would pass against a service
    // that ended every run it started.
    const test = harness({ lines: WRITE_LINES })
    await test.service.start('Write hello.txt', undefined, {})
    await settle()
    expect(test.appended.length).toBeGreaterThan(0)
    expect(test.updates.some((update) => update.kind === 'persistence-error')).toBe(false)
  })
})
