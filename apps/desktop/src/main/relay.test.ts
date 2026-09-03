import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate } from '../shared/ipc.js'
import { MAX_RELAY_HOPS, createRelay, decideRelay, relayPrompt } from './relay.js'
import type { RelayOptions, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom' }

const wrenPeer: MissionPeerContext = { self: WREN, others: [BOOTY] }
const bootyPeer: MissionPeerContext = { self: BOOTY, others: [WREN] }

function message(to: { teammateId: string; name: string }, text = 'What is the build command?'): WorkroomMessage {
  return {
    messageId: `msg_${to.teammateId}`,
    from: { teammateId: WREN.teammateId, name: WREN.name, missionId: 'mission_wren1' },
    to,
    text,
    postedAt: '2026-09-03T10:00:00.000Z'
  } as WorkroomMessage
}

function sharing(overrides: Partial<SharingMission> = {}): SharingMission {
  return {
    runId: 'run_wren1',
    missionId: 'mission_wren1',
    runtime: 'cursor',
    sandbox: 'workspace-write',
    model: 'composer-2.5',
    peer: wrenPeer,
    relay: undefined,
    ...overrides
  }
}

function harness(options: { enabled?: boolean; startResult?: CodexMissionStartResponse } = {}) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const owners: [string, string][] = []
  const notices: CodexMissionUpdate[] = []
  const relay = createRelay({
    enabled: async () => options.enabled ?? true,
    peerContextFor: async (id) => (id === BOOTY.teammateId ? bootyPeer : id === WREN.teammateId ? wrenPeer : undefined),
    start: async (input) => {
      starts.push(input)
      return (
        options.startResult ?? {
          ok: true,
          data: {
            runId: `run_${String(starts.length)}`,
            missionId: `mission_${String(starts.length)}`,
            runtime: input.runtime,
            model: input.model ?? 'account-default',
            resolvedRouteId: 'cursor-account:default',
            cliVersion: null,
            sandbox: input.mode === 'accept-edits' ? 'workspace-write' : 'read-only',
            peerMessages: [],
            peerDeliveryFailed: false
          }
        }
      )
    },
    assignOwner: async (teammateId, missionId) => {
      owners.push([teammateId, missionId])
    },
    notify: (update) => notices.push(update)
  })
  return { relay, starts, owners, notices }
}

describe('deciding whether a teammate replies on their own', () => {
  it('is off by default, and says the message waits', () => {
    const decision = decideRelay({ enabled: false, hop: 0, recipientName: 'Booty' })
    expect(decision.start).toBe(false)
    expect(decision.start ? '' : decision.reason).toMatch(/off in Settings/)
  })

  it('starts the first hop when switched on', () => {
    expect(decideRelay({ enabled: true, hop: 0, recipientName: 'Booty' })).toEqual({ start: true, hop: 1 })
  })

  it('stops at the cap, naming who will see the message next', () => {
    const decision = decideRelay({ enabled: true, hop: MAX_RELAY_HOPS, recipientName: 'Booty' })
    expect(decision.start).toBe(false)
    expect(decision.start ? '' : decision.reason).toContain('Booty')
    expect(decision.start ? '' : decision.reason).toContain(String(MAX_RELAY_HOPS))
  })

  it('caps at two hops: one question, one answer', () => {
    expect(MAX_RELAY_HOPS).toBe(2)
  })
})

describe('the brief a relayed run is started with', () => {
  it('names the sender, asks for a share block back, and forbids unrelated work', () => {
    const prompt = relayPrompt({ sender: WREN, recipient: BOOTY, hop: 1 })
    expect(prompt).toContain('Wren (Code & Migrations)')
    expect(prompt).toContain('<locust-share to="Wren">')
    expect(prompt).toContain('Do not start unrelated work')
  })

  it('on the way back, does not demand another reply', () => {
    const prompt = relayPrompt({ sender: BOOTY, recipient: WREN, hop: MAX_RELAY_HOPS })
    expect(prompt).toContain('Booty (Custom) replied')
    expect(prompt).not.toContain('exactly one')
    expect(prompt).toContain('otherwise end with no share block')
  })
})

describe('relaying a share', () => {
  it('starts nothing when off, and stays quiet about it', async () => {
    const { relay, starts, notices } = harness({ enabled: false })
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts).toHaveLength(0)
    expect(notices).toHaveLength(0)
  })

  it("starts the recipient's run on the sender's route, mode and model, owned by the recipient", async () => {
    const { relay, starts, owners, notices } = harness()
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      runtime: 'cursor',
      mode: 'accept-edits',
      model: 'composer-2.5',
      peer: bootyPeer,
      followUpOf: undefined,
      relay: { hop: 1, originMissionId: 'mission_wren1' }
    })
    expect(starts[0]?.prompt).toContain('Wren (Code & Migrations) sent you a message')
    expect(owners).toEqual([[BOOTY.teammateId, 'mission_1']])
    const started = notices.find((update) => update.kind === 'mission-started')
    expect(started).toMatchObject({ kind: 'mission-started', teammateId: BOOTY.teammateId, hop: 1 })
  })

  it('a read-only sender gets a read-only reply', async () => {
    const { relay, starts } = harness()
    await relay.onShared(sharing({ sandbox: 'read-only' }), [message(BOOTY)])
    expect(starts[0]?.mode).toBe('ask')
  })

  it("the reply back follows up the mission that asked, so it lands in that thread", async () => {
    const { relay, starts } = harness()
    const bootyRun = sharing({
      runId: 'run_booty',
      missionId: 'mission_booty',
      peer: bootyPeer,
      relay: { hop: 1, originMissionId: 'mission_wren1' }
    })
    await relay.onShared(bootyRun, [{ ...message(WREN), from: { ...BOOTY, missionId: 'mission_booty' } } as WorkroomMessage])
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      peer: wrenPeer,
      followUpOf: 'mission_wren1',
      relay: { hop: 2, originMissionId: 'mission_wren1' }
    })
  })

  it('stops after the cap and says so in the thread that shared', async () => {
    const { relay, starts, notices } = harness()
    const capped = sharing({ runId: 'run_wren2', missionId: 'mission_wren2', relay: { hop: 2, originMissionId: 'mission_wren1' } })
    await relay.onShared(capped, [message(BOOTY)])
    expect(starts).toHaveLength(0)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'relay-notice', runId: 'run_wren2', missionId: 'mission_wren2' })
    expect(notices[0]?.kind === 'relay-notice' ? notices[0].message : '').toContain('Stopped after 2')
  })

  it("says why when the recipient's run could not start, and lets the message wait", async () => {
    const { relay, notices, owners } = harness({
      startResult: { ok: false, error: { code: 'RUN_ALREADY_ACTIVE', message: 'Booty already has a mission running.' } }
    })
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(owners).toHaveLength(0)
    expect(notices[0]?.kind === 'relay-notice' ? notices[0].message : '').toContain('Booty already has a mission running')
    expect(notices[0]?.kind === 'relay-notice' ? notices[0].message : '').toContain('waits for their next run')
  })

  it('starts one run per recipient however many messages went to them', async () => {
    const { relay, starts } = harness()
    await relay.onShared(sharing(), [message(BOOTY, 'first'), message(BOOTY, 'second')])
    expect(starts).toHaveLength(1)
  })

  it('does not start anything for a recipient no longer on the roster', async () => {
    const { relay, starts, notices } = harness()
    await relay.onShared(sharing(), [message({ teammateId: 'tm_gone', name: 'Gone' })])
    expect(starts).toHaveLength(0)
    expect(notices[0]?.kind === 'relay-notice' ? notices[0].message : '').toContain('no longer on the roster')
  })

  it('treats an unreadable setting as off', async () => {
    const starts: unknown[] = []
    const relay = createRelay({
      enabled: async () => {
        throw new Error('disk')
      },
      peerContextFor: async () => bootyPeer,
      start: async (input) => {
        starts.push(input)
        throw new Error('should not start')
      },
      assignOwner: async () => undefined,
      notify: () => undefined
    })
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts).toHaveLength(0)
  })
})
