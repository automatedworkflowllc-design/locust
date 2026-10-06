import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent, RuntimeDiscovery, RuntimeProcessCompletion, RuntimeProcessRun } from '@teammate/runtime-adapters'
import { describe, expect, it, vi } from 'vitest'

import { createAntigravityMissionService } from './antigravity-mission.js'
import { createCodexMissionService } from './codex-mission.js'
import type { MissionPeerContext } from './workroom-briefing.js'

const NOW = '2026-10-06T12:00:00.000Z'
const PEER: MissionPeerContext = {
  self: { teammateId: 'tm_wren', name: 'Wren', role: 'Code' },
  others: [{ teammateId: 'tm_atlas', name: 'Atlas', role: 'Research' }]
}
const MESSAGE: WorkroomMessage = {
  messageId: 'wm_1', sequence: 1, postedAt: NOW,
  from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_origin' },
  to: { teammateId: 'tm_wren', name: 'Wren' }, text: 'Check the PELICAN migration.'
}
const RELAY = { hop: 1, lastMissionOf: {}, answering: [MESSAGE.messageId] }
const PROMPT = 'Atlas sent you a message; it is quoted below.'

function receipts() {
  const deliveries: { messageIds: readonly string[]; missionId: string }[] = []
  const events: NormalizedRuntimeEvent[] = []
  const workroom: Workroom = {
    unread: async () => ({ messages: deliveries.length === 0 ? [MESSAGE] : [], remaining: 0 }),
    markDelivered: async (messageIds, missionId) => { deliveries.push({ messageIds, missionId }) },
    read: async () => ({ messages: [MESSAGE], deliveries: [], issues: [] }),
    post: async () => { throw new Error('No share is expected') },
    flush: async () => undefined
  }
  const ledger = {
    createMission: async () => undefined,
    appendPeerLinks: async () => undefined,
    appendEvents: async (_missionId: string, appended: readonly NormalizedRuntimeEvent[]) => { events.push(...appended) },
    appendHostFailure: async () => undefined,
    appendEditCheck: async () => undefined,
    getMission: async () => undefined
  } as unknown as MissionLedger
  return { workroom, ledger, events, deliveries }
}

const runtime: RuntimeDiscovery = {
  id: 'codex', kind: 'agent-runtime', displayName: 'Codex CLI', optional: false,
  availability: 'available', readiness: 'ready',
  executable: {
    commandName: 'codex', discoveredPath: '/tools/codex', executablePath: '/tools/codex', prefixArgs: [], kind: 'native'
  },
  supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'],
  requiredFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'], diagnostics: []
}

function processRun(values: readonly Record<string, unknown>[]): RuntimeProcessRun {
  const completion: RuntimeProcessCompletion = {
    exitCode: 1, signal: null, stderr: 'The CLI refused its arguments.', stderrTruncated: false,
    recordCount: values.length, cancelled: false, forcedTerminationAttempted: false,
    terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false,
    oversizedRecordsDropped: 0, startedAt: NOW, finishedAt: NOW
  }
  return {
    records: {
      async *[Symbol.asyncIterator]() {
        for (const [index, value] of values.entries()) yield { sequence: index + 1, raw: JSON.stringify(value) }
      },
      drainAvailable: () => []
    },
    completion: Promise.resolve(completion)
  }
}

describe('messages on the process transports', () => {
  const setUp = (first: readonly Record<string, unknown>[], id: 'codex' | 'antigravity' = 'codex') => {
    const held = receipts()
    const scheduled: (() => void)[] = []
    const prompts: string[] = []
    let ids = 0
    const service = createCodexMissionService({
      workspacePath: process.platform === 'win32' ? 'C:\\safe-workspace' : '/safe-workspace',
      discover: async () => [{ ...runtime, id, executable: { ...runtime.executable!, commandName: id === 'antigravity' ? 'agy' : 'codex' } }],
      ledger: held.ledger, workroom: held.workroom,
      runner: { start: (_command, prompt) => {
        prompts.push(prompt)
        return processRun(prompts.length === 1 ? first : id === 'codex'
          ? [{ type: 'thread.started', thread_id: 'next' }]
          : [{ event: 'init', conversation_id: 'next' }])
      } },
      schedule: (task) => scheduled.push(task), createId: () => String(++ids), now: () => new Date(NOW)
    })
    const start = () => service.start(PROMPT, id, 'ask', {}, () => undefined, undefined, PEER, undefined, RELAY)
    const finish = async () => {
      scheduled.shift()!()
      await vi.waitFor(() => expect(service.liveMissionIds()).toEqual([]))
    }
    return { ...held, service, prompts, start, finish }
  }

  it('leaves an instantly refused relay message waiting and quotes it on the next run', async () => {
    const h = setUp([])
    expect(await h.start()).toMatchObject({ ok: true })
    expect(h.deliveries).toEqual([])
    await h.finish()
    expect(h.events.some((event) => event.type === 'run.failed')).toBe(true)
    expect(h.deliveries).toEqual([])
    expect((await h.workroom.unread('tm_wren', 10)).messages).toEqual([MESSAGE])
    expect(await h.start()).toMatchObject({ ok: true })
    expect(h.prompts[1]).toContain('CLAIMS from other agents')
    expect(h.prompts[1]).toContain(MESSAGE.text)
    await h.finish()
    expect(h.deliveries).toHaveLength(1)
    await h.service.dispose()
  })

  it('keeps delivery after a relay started and failed, without quoting it again', async () => {
    const h = setUp([{ type: 'thread.started', thread_id: 'first' }, { type: 'turn.started' }])
    expect(await h.start()).toMatchObject({ ok: true })
    expect(h.deliveries).toEqual([])
    await h.finish()
    expect(h.events.map((event) => event.type)).toContain('run.failed')
    expect(h.deliveries).toEqual([{ messageIds: ['wm_1'], missionId: 'mission_2' }])
    expect(await h.start()).toMatchObject({ ok: true })
    expect(h.prompts[1]).not.toContain(MESSAGE.text)
    await h.finish()
    expect(h.deliveries).toHaveLength(1)
    await h.service.dispose()
  })

  it('an Antigravity CLI diagnostic leaves the relay message for the next real turn', async () => {
    const h = setUp([{ event: 'startup-error' }], 'antigravity')
    expect(await h.start()).toMatchObject({ ok: true })
    await h.finish()
    expect(h.events.map((event) => event.type)).toContain('adapter.diagnostic')
    expect(h.deliveries).toEqual([])
    expect(await h.start()).toMatchObject({ ok: true })
    expect(h.prompts[1]).toContain(MESSAGE.text)
    await h.finish()
    expect(h.events.map((event) => event.type)).toContain('step.started')
    expect(h.deliveries).toHaveLength(1)
    await h.service.dispose()
  })
})

describe('messages on Antigravity hub', () => {
  const setUp = () => {
    const held = receipts()
    const prompts: string[] = []
    let lines = ''
    let ids = 0
    const service = createAntigravityMissionService({
      workspacePath: 'C:\\work\\pebble', home: 'C:\\Users\\dev', ledger: held.ledger, workroom: held.workroom,
      probe: async () => ({ executablePath: '/tools/server', version: '2.11.0', address: 'localhost:1', csrfToken: 'fixture', projects: new Map([['c:/work/pebble', 'project']]) }),
      agentApi: () => ({ newConversation: async (input) => { prompts.push(input.prompt); return `conversation_${prompts.length}` }, sendMessage: async () => undefined }),
      cascadeApi: () => ({ plannerTexts: async () => [], pendingQuestion: async () => undefined, answerQuestion: async () => undefined }),
      readTranscript: async () => lines, statTranscript: async () => undefined,
      observeDisk: async () => undefined, pollMs: 5, idleTimeoutMs: 60_000,
      createId: () => String(++ids), now: () => new Date(NOW), emitEvent: () => undefined, emitUpdate: () => undefined
    })
    const start = () => service.start(PROMPT, PEER, { relay: RELAY })
    const stop = async (runId: string) => {
      expect(service.cancel(runId)).toBe(true)
      await vi.waitFor(() => expect(service.liveMissionIds()).toEqual([]))
    }
    return { ...held, service, prompts, start, stop, setLines: (text: string) => { lines = text } }
  }

  it('leaves a silent hub run undelivered and quotes its message on the next run', async () => {
    const h = setUp()
    try {
      const first = await h.start()
      await h.stop(first.runId)
      expect(h.deliveries).toEqual([])
      await h.start()
      expect(h.prompts[1]).toContain(MESSAGE.text)
      expect(h.deliveries).toEqual([])
    } finally { await h.service.dispose() }
  })

  it('marks a hub message on its first step and keeps it delivered when stopped', async () => {
    const h = setUp()
    try {
      const first = await h.start()
      expect(h.deliveries).toEqual([])
      h.setLines(JSON.stringify({ step_index: 0, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', created_at: NOW, tool_calls: [{ name: 'read_file', args: { TargetFile: 'notes.md' } }] }))
      await vi.waitFor(() => expect(h.deliveries).toHaveLength(1))
      expect(h.events.map((event) => event.type)).toContain('tool.started')
      await h.stop(first.runId)
      h.setLines('')
      await h.start()
      expect(h.prompts[1]).not.toContain(MESSAGE.text)
      expect(h.deliveries).toHaveLength(1)
    } finally { await h.service.dispose() }
  })
})
