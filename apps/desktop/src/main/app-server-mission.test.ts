import { describe, expect, it, vi } from 'vitest'

import type { MissionLedger, Workroom, WorkroomMessage } from '@teammate/mission-store'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

import {
  approvalKindFor,
  createAppServerMissionService,
  describeApproval,
  protocolDecisionFor
} from './app-server-mission.js'
import type { AppServerProcess } from './app-server-mission.js'
import type { CodexMissionUpdate, MissionApprovalRequest } from '../shared/ipc.js'

const NOW = '2026-09-01T10:00:00.000Z'

function codexRuntime(): RuntimeDiscovery {
  return {
    id: 'codex',
    kind: 'agent-runtime',
    displayName: 'Codex CLI',
    optional: false,
    availability: 'available',
    readiness: 'ready',
    executable: {
      commandName: 'codex',
      discoveredPath: 'C:\\tools\\codex.exe',
      executablePath: 'C:\\tools\\codex.exe',
      prefixArgs: [],
      kind: 'native'
    },
    version: { raw: 'codex 1.0.0', version: '1.0.0', major: 1, minor: 0, patch: 0 },
    supportedFeatures: [],
    requiredFeatures: [],
    diagnostics: []
  }
}

function fakeLedger(overrides: Partial<MissionLedger> = {}): MissionLedger {
  return {
    createMission: async () => undefined,
    appendEvents: async () => undefined,
    appendHostFailure: async () => undefined,
    createCheckpoint: async () => {
      throw new Error('not used')
    },
    appendPeerLinks: async () => undefined,
    getMission: async () => undefined,
    listMissions: async () => ({ missions: [], issues: [] }),
    flush: async () => undefined,
    ...overrides
  }
}

/** A fake app-server that lets a test drive both directions of the protocol. */
function fakeProcess() {
  const written: string[] = []
  let onData: (chunk: string) => void = () => undefined
  let onExit: () => void = () => undefined
  let killed = false
  const process: AppServerProcess = {
    write: (line) => {
      written.push(line)
      // Answer every client request so start() can proceed.
      const message = JSON.parse(line) as Record<string, unknown>
      if (message.id === undefined) return
      const result =
        message.method === 'thread/start' ? { thread: { id: 'th_1' } } : {}
      queueMicrotask(() => onData(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`))
    },
    kill: () => {
      killed = true
    },
    onData: (listener) => {
      onData = listener
    },
    onExit: (listener) => {
      onExit = listener
    }
  }
  return {
    process,
    written,
    push: (message: unknown) => onData(`${JSON.stringify(message)}\n`),
    exit: () => onExit(),
    isKilled: () => killed,
    parsed: () => written.map((line) => JSON.parse(line) as Record<string, unknown>)
  }
}

function service(overrides: { ledger?: MissionLedger; workroom?: Workroom } = {}) {
  const fake = fakeProcess()
  const approvals: MissionApprovalRequest[] = []
  const events: unknown[] = []
  const updates: CodexMissionUpdate[] = []
  let nextId = 0
  const instance = createAppServerMissionService({
    workspacePath: 'C:\\work',
    ledger: overrides.ledger ?? fakeLedger(),
    discover: async () => [codexRuntime()],
    spawn: () => fake.process,
    emitApproval: (request) => approvals.push(request),
    emitEvent: (_runId, _missionId, event) => events.push(event),
    emitUpdate: (update) => updates.push(update),
    ...(overrides.workroom === undefined ? {} : { workroom: overrides.workroom }),
    createId: () => String(++nextId),
    now: () => new Date(NOW)
  })
  return { instance, fake, approvals, events, updates }
}

describe('approval descriptions', () => {
  it('recognizes the three protocol methods and nothing else', () => {
    expect(approvalKindFor('item/commandExecution/requestApproval')).toBe('command')
    expect(approvalKindFor('item/fileChange/requestApproval')).toBe('file-change')
    expect(approvalKindFor('item/tool/requestUserInput')).toBe('question')
    expect(approvalKindFor('item/somethingNew/requestApproval')).toBeUndefined()
  })

  it('carries the exact command so the card can say what would happen', () => {
    const described = describeApproval({
      id: 1,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'rm -rf build', cwd: 'C:\\work' }
    })
    expect(described).toMatchObject({ kind: 'command', detail: 'rm -rf build', cwd: 'C:\\work' })
  })

  it('says so plainly when the runtime described nothing', () => {
    // A card that cannot say what would happen is not an approval, it is a
    // dare -- so the absence is stated rather than hidden behind a generic
    // "Run a command".
    const described = describeApproval({ id: 1, method: 'item/commandExecution/requestApproval', params: {} })
    expect(described?.summary).toMatch(/did not describe/)
  })

  it('counts file changes rather than pasting a diff', () => {
    const described = describeApproval({
      id: 1,
      method: 'item/fileChange/requestApproval',
      params: { changes: [1, 2], summary: 'update config' }
    })
    expect(described?.summary).toBe('Change 2 files')
    expect(described?.detail).toBe('update config')
  })

  it('bounds a very long command', () => {
    const described = describeApproval({
      id: 1,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'x'.repeat(9_000) }
    })
    expect((described?.detail ?? '').length).toBeLessThanOrEqual(4_000)
  })
})

describe('decisions', () => {
  it('maps the product answers onto the protocol', () => {
    expect(protocolDecisionFor('approve-once')).toBe('accept')
    // Session-scoped, never durable: a forever-grant is a Settings decision.
    expect(protocolDecisionFor('approve-always')).toBe('acceptForSession')
    expect(protocolDecisionFor('deny')).toBe('reject')
  })
})

describe('the approval round trip', () => {
  async function started() {
    const harness = service()
    await harness.instance.start('Do something consequential.')
    return harness
  }

  it('surfaces an approval request to the UI and answers it when decided', async () => {
    const { instance, fake, approvals } = await started()

    fake.push({
      jsonrpc: '2.0',
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'pnpm build', cwd: 'C:\\work' }
    })
    await vi.waitFor(() => {
      expect(approvals).toHaveLength(1)
    })
    expect(instance.pendingApprovalCount).toBe(1)

    expect(instance.decide({ approvalId: approvals[0]!.approvalId, decision: 'approve-once' })).toBe(true)
    await vi.waitFor(() => {
      const reply = fake.parsed().find((message) => message.id === 'srv-1')
      expect(reply).toMatchObject({ result: { decision: 'accept' } })
    })
    expect(instance.pendingApprovalCount).toBe(0)
  })

  it('ignores a decision for an unknown or already-answered approval', async () => {
    const { instance, fake, approvals } = await started()
    fake.push({ jsonrpc: '2.0', id: 's1', method: 'item/fileChange/requestApproval', params: { changes: [1] } })
    await vi.waitFor(() => {
      expect(approvals).toHaveLength(1)
    })
    const id = approvals[0]!.approvalId
    expect(instance.decide({ approvalId: id, decision: 'deny' })).toBe(true)
    // A double click on the card must not take the run down.
    expect(instance.decide({ approvalId: id, decision: 'approve-once' })).toBe(false)
    expect(instance.decide({ approvalId: 'nope', decision: 'approve-once' })).toBe(false)
  })

  it('refuses a request it does not understand rather than guessing', async () => {
    const { fake, approvals } = await started()
    fake.push({ jsonrpc: '2.0', id: 's9', method: 'item/futureThing/requestApproval', params: {} })
    await vi.waitFor(() => {
      const reply = fake.parsed().find((message) => message.id === 's9')
      expect(reply).toMatchObject({ result: { decision: 'reject' } })
    })
    // And it never reaches the UI, because the UI could not describe it either.
    expect(approvals).toHaveLength(0)
  })

  it('releases a pending approval when the runtime dies', async () => {
    const { instance, fake, approvals } = await started()
    fake.push({ jsonrpc: '2.0', id: 's1', method: 'item/commandExecution/requestApproval', params: { command: 'x' } })
    await vi.waitFor(() => {
      expect(approvals).toHaveLength(1)
    })

    fake.exit()

    // Nobody should be left staring at a card that nothing will ever answer.
    expect(instance.pendingApprovalCount).toBe(0)
  })

  it('releases pending approvals on cancel and on dispose', async () => {
    const first = await started()
    first.fake.push({ jsonrpc: '2.0', id: 's1', method: 'item/commandExecution/requestApproval', params: { command: 'x' } })
    await vi.waitFor(() => {
      expect(first.approvals).toHaveLength(1)
    })
    first.instance.cancel()
    expect(first.instance.pendingApprovalCount).toBe(0)
    expect(first.fake.isKilled()).toBe(true)

    const second = await started()
    second.fake.push({ jsonrpc: '2.0', id: 's1', method: 'item/fileChange/requestApproval', params: { changes: [1] } })
    await vi.waitFor(() => {
      expect(second.approvals).toHaveLength(1)
    })
    await second.instance.dispose()
    expect(second.instance.pendingApprovalCount).toBe(0)
  })
})

describe('durability', () => {
  it('records the mission as workspace-write, because approvals only matter when it could act', async () => {
    const createMission = vi.fn<MissionLedger['createMission']>(async () => undefined)
    const harness = service({ ledger: fakeLedger({ createMission }) })
    await harness.instance.start('Do work.')
    expect(createMission).toHaveBeenCalledWith(
      expect.objectContaining({ sandbox: 'workspace-write', resolvedRouteId: 'codex-app-server:default' })
    )
  })

  it('persists events before emitting them', async () => {
    const order: string[] = []
    const harness = service({
      ledger: fakeLedger({
        appendEvents: async () => {
          order.push('persist')
        }
      })
    })
    const events: string[] = []
    await harness.instance.start('Do work.')
    harness.fake.push({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: 't', turn: {} } })
    await vi.waitFor(() => {
      expect(harness.events.length).toBeGreaterThan(0)
    })
    order.push('emit')
    events.push(...order)
    expect(order[0]).toBe('persist')
  })

  it('refuses to start a second mission while one is running', async () => {
    const harness = service()
    await harness.instance.start('First.')
    await expect(harness.instance.start('Second.')).rejects.toThrow(/already running/)
  })
})

describe('the workroom around an approval-mode mission', () => {
  const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
  const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
  const PEER = { self: WREN, others: [ATLAS] }

  function fakeWorkroom(unread: readonly WorkroomMessage[] = []) {
    const posted: { text: string; to: unknown }[] = []
    const delivered: string[][] = []
    const workroom: Workroom = {
      post: async (input) => {
        posted.push({ text: input.text, to: input.to })
        return { messageId: 'wm_out', sequence: 1, from: input.from, to: input.to, text: input.text, postedAt: NOW }
      },
      unread: async () => ({ messages: unread, remaining: 0 }),
      markDelivered: async (ids) => {
        delivered.push([...ids])
      },
      read: async () => ({ messages: [], deliveries: [], issues: [] }),
      flush: async () => undefined
    }
    return { workroom, posted, delivered }
  }

  const waiting: WorkroomMessage = {
    messageId: 'wm_1',
    sequence: 1,
    from: { teammateId: 'tm_atlas', name: 'Atlas', missionId: 'mission_a' },
    to: { teammateId: 'tm_wren', name: 'Wren' },
    text: 'pnpm check runs everything.',
    postedAt: NOW
  }

  it("briefs an approval-mode mission with its teammates' waiting messages", async () => {
    const { workroom, delivered } = fakeWorkroom([waiting])
    const links: unknown[] = []
    const harness = service({
      workroom,
      ledger: fakeLedger({ appendPeerLinks: async (_missionId, appended) => { links.push(...appended) } })
    })

    const mission = await harness.instance.start('Which command runs the checks?', PEER)

    const turn = harness.fake.parsed().find((message) => message.method === 'turn/start')
    const text = ((turn?.params as { input: { text: string }[] }).input[0]?.text) ?? ''
    expect(text.startsWith('Which command runs the checks?')).toBe(true)
    expect(text).toContain('CLAIMS from other agents')
    expect(text).toContain('pnpm check runs everything.')
    expect(links).toEqual([{ direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_atlas', occurredAt: NOW }])
    expect(delivered).toEqual([['wm_1']])
    expect(mission.peerMessages.map((entry) => entry.messageId)).toEqual(['wm_1'])
  })

  it('shares from an approval-mode run once it completes, and not before', async () => {
    const { workroom, posted } = fakeWorkroom()
    const harness = service({ workroom })
    await harness.instance.start('Find the check command.', PEER)

    harness.fake.push({
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 't',
        item: { id: 'answer', type: 'agentMessage', text: 'Found it.\n\n<locust-share to="Atlas">\npnpm check is the gate.\n</locust-share>' }
      }
    })
    await vi.waitFor(() => {
      expect(harness.events.length).toBeGreaterThan(0)
    })
    // The message alone is not a completed run; a half-finished claim is not shared.
    expect(posted).toEqual([])

    harness.fake.push({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: 't', turn: {} } })
    await vi.waitFor(() => {
      expect(posted).toHaveLength(1)
    })
    expect(posted[0]).toEqual({ text: 'pnpm check is the gate.', to: { teammateId: 'tm_atlas', name: 'Atlas' } })
    await vi.waitFor(() => {
      expect(harness.updates.filter((update) => update.kind === 'peer-message')).toHaveLength(1)
    })
  })

  it('refuses to start on messages the ledger cannot record', async () => {
    const { workroom, delivered } = fakeWorkroom([waiting])
    const harness = service({
      workroom,
      ledger: fakeLedger({ appendPeerLinks: async () => { throw new Error('disk full') } })
    })
    await expect(harness.instance.start('Task.', PEER)).rejects.toThrow('could not be recorded')
    expect(harness.fake.parsed().some((message) => message.method === 'turn/start')).toBe(false)
    expect(delivered).toEqual([])
  })
})
