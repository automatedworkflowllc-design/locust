import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate } from '../shared/ipc.js'
import { MAX_RELAY_HOPS, createRelay, decideRelay, meetingPrompt, relayPrompt } from './relay.js'
import type { RelayOptions, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom' }

const BOOTY_ROUTE = { runtime: 'claude' as const, model: 'sonnet', mode: 'ask' as const }
const wrenPeer: MissionPeerContext = { self: WREN, others: [BOOTY] }
const bootyPeer: MissionPeerContext = { self: { ...BOOTY, route: BOOTY_ROUTE }, others: [WREN] }
/** Booty before anyone has run them: no route of their own. */
const newBootyPeer: MissionPeerContext = { self: BOOTY, others: [WREN] }

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

function harness(options: { enabled?: boolean; startResult?: CodexMissionStartResponse; booty?: MissionPeerContext } = {}) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const owners: [string, string][] = []
  const notices: CodexMissionUpdate[] = []
  const relay = createRelay({
    enabled: async () => options.enabled ?? true,
    peerContextFor: async (id) =>
      id === BOOTY.teammateId ? (options.booty ?? bootyPeer) : id === WREN.teammateId ? wrenPeer : undefined,
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
  it('when switched off, says the message waits', () => {
    const decision = decideRelay({ enabled: false, hop: 0, recipientName: 'Booty' })
    expect(decision.start).toBe(false)
    expect(decision.start ? '' : decision.reason).toMatch(/switched off in Settings/)
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

  it('the cap is a backstop, not a conversation length', () => {
    // Three round trips. An exchange normally ends earlier, when a reply
    // has nothing more to say and posts no share.
    expect(MAX_RELAY_HOPS).toBe(6)
  })
})

describe('the brief a relayed run is started with', () => {
  it('names the sender, shows how to write back, and forbids unrelated work', () => {
    const prompt = relayPrompt({ sender: WREN, recipient: BOOTY, hop: 1 })
    expect(prompt).toContain('Wren (Code & Migrations) sent you a message')
    expect(prompt).toContain('<locust-share to="Wren">')
    expect(prompt).toContain('Do not start unrelated work')
  })

  it('every hop is told that silence is how an exchange finishes', () => {
    for (const hop of [1, 2, 5]) {
      const prompt = relayPrompt({ sender: BOOTY, recipient: WREN, hop })
      expect(prompt).toContain('Write back only if that helps finish the work')
      expect(prompt).toContain('end with no share block')
    }
    expect(relayPrompt({ sender: BOOTY, recipient: WREN, hop: 2 })).toContain('Booty (Custom) replied to you')
  })

  it('tells a relayed run to ask the teammate, not a person', () => {
    // MEASURED 2026-09-05, three runs of relay-smoke: the recipient declined a
    // request as a possible prompt injection and asked for context with a
    // <locust-ask> block -- which reaches only a person, and a relayed run
    // has none. The question sat in a thread nobody was watching and the
    // exchange ended in silence. The teammate who asked is the right
    // recipient, and the share block is how to reach them.
    const prompt = relayPrompt({ sender: WREN, recipient: BOOTY, hop: 1 })
    expect(prompt).toContain('There is no person in this exchange')
    expect(prompt).toContain('ask Wren inside that share block')
    expect(prompt).toContain('Do not use a <locust-ask> block here')
  })

  it('says the same after a meeting, where several teammates could be asked', () => {
    const prompt = meetingPrompt({ repliers: ['Atlas', 'Juno'], silent: [] })
    expect(prompt).toContain('There is no person in this exchange')
    expect(prompt).toContain('never in a <locust-ask> block')
  })
})

describe('relaying a share', () => {
  it('starts nothing when off, and stays quiet about it', async () => {
    const { relay, starts, notices } = harness({ enabled: false })
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts).toHaveLength(0)
    expect(notices).toHaveLength(0)
  })

  it("starts the recipient's run on the recipient's OWN route, owned by the recipient", async () => {
    // Wren is Cursor / composer-2.5 with edits; Booty is Claude Code / sonnet,
    // read-only. Booty answers as Booty.
    const { relay, starts, owners, notices } = harness()
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      runtime: 'claude',
      mode: 'ask',
      model: 'sonnet',
      peer: bootyPeer,
      followUpOf: undefined,
      relay: { hop: 1, lastMissionOf: { tm_wren: 'mission_wren1' } }
    })
    expect(notices.some((update) => update.kind === 'relay-notice')).toBe(false)
    expect(starts[0]?.prompt).toContain('Wren (Code & Migrations) sent you a message')
    expect(owners).toEqual([[BOOTY.teammateId, 'mission_1']])
    const started = notices.find((update) => update.kind === 'mission-started')
    expect(started).toMatchObject({ kind: 'mission-started', teammateId: BOOTY.teammateId, hop: 1 })
  })

  it('a teammate who has never run borrows the sender\'s route, and the thread says so', async () => {
    const { relay, starts, notices } = harness({ booty: newBootyPeer })
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts[0]).toMatchObject({ runtime: 'cursor', model: 'composer-2.5', mode: 'accept-edits' })
    const said = notices.find((update) => update.kind === 'relay-notice')
    expect(said?.kind === 'relay-notice' ? said.message : '').toContain('has not run on a route of their own')
    expect(said?.kind === 'relay-notice' ? said.message : '').toContain('Cursor Agent / composer-2.5')
  })

  it('a read-only sender gets a read-only reply when the recipient has no route', async () => {
    const { relay, starts } = harness({ booty: newBootyPeer })
    await relay.onShared(sharing({ sandbox: 'read-only' }), [message(BOOTY)])
    expect(starts[0]?.mode).toBe('ask')
  })

  it("an account-default route is sent as no model, the way the composer sends it", async () => {
    const { relay, starts } = harness({ booty: { self: { ...BOOTY, route: { runtime: 'codex', model: 'account-default', mode: 'ask' } }, others: [WREN] } })
    await relay.onShared(sharing(), [message(BOOTY)])
    expect(starts[0]).toMatchObject({ runtime: 'codex', model: undefined })
  })

  it("the reply back follows up the mission that asked, so it lands in that thread", async () => {
    const { relay, starts } = harness()
    const bootyRun = sharing({
      runId: 'run_booty',
      missionId: 'mission_booty',
      peer: bootyPeer,
      relay: { hop: 1, lastMissionOf: { tm_wren: 'mission_wren1' } }
    })
    await relay.onShared(bootyRun, [{ ...message(WREN), from: { ...BOOTY, missionId: 'mission_booty' } } as WorkroomMessage])
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({
      peer: wrenPeer,
      followUpOf: 'mission_wren1',
      relay: { hop: 2, lastMissionOf: { tm_wren: 'mission_wren1', tm_booty: 'mission_booty' } }
    })
  })

  it("a third hop continues the recipient's OWN earlier turn, so their side reads as one thread too", async () => {
    const { relay, starts } = harness()
    const wrenAgain = sharing({
      runId: 'run_wren2',
      missionId: 'mission_wren2',
      relay: { hop: 2, lastMissionOf: { tm_wren: 'mission_wren1', tm_booty: 'mission_booty' } }
    })
    await relay.onShared(wrenAgain, [message(BOOTY, 'One more thing.')])
    expect(starts[0]).toMatchObject({
      peer: bootyPeer,
      followUpOf: 'mission_booty',
      relay: { hop: 3, lastMissionOf: { tm_wren: 'mission_wren2', tm_booty: 'mission_booty' } }
    })
  })

  it('stops after the cap and says so in the thread that shared', async () => {
    const { relay, starts, notices } = harness()
    const capped = sharing({ runId: 'run_wren2', missionId: 'mission_wren2', relay: { hop: MAX_RELAY_HOPS, lastMissionOf: { tm_wren: 'mission_wren1' } } })
    await relay.onShared(capped, [message(BOOTY)])
    expect(starts).toHaveLength(0)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'relay-notice', runId: 'run_wren2', missionId: 'mission_wren2' })
    expect(notices[0]?.kind === 'relay-notice' ? notices[0].message : '').toContain(`Stopped after ${String(MAX_RELAY_HOPS)}`)
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

describe('a meeting: one asks several, and the next turn waits for all of them', () => {
  const ATLAS = { teammateId: 'tm_atlas', name: 'Atlas', role: 'Research & Briefs' }
  const ATLAS_ROUTE = { runtime: 'codex' as const, model: 'account-default', mode: 'ask' as const }
  const three = (self: { teammateId: string; name: string; role: string; route?: unknown }): MissionPeerContext => ({
    self: self as MissionPeerContext['self'],
    others: [WREN, BOOTY, ATLAS].filter((entry) => entry.teammateId !== self.teammateId)
  })
  function meetingHarness() {
    const starts: Parameters<RelayOptions['start']>[0][] = []
    const notices: string[] = []
    let count = 0
    const relay = createRelay({
      enabled: async () => true,
      peerContextFor: async (id) =>
        id === WREN.teammateId ? three(WREN) : id === BOOTY.teammateId ? three({ ...BOOTY, route: BOOTY_ROUTE }) : id === ATLAS.teammateId ? three({ ...ATLAS, route: ATLAS_ROUTE }) : undefined,
      start: async (input) => {
        starts.push(input)
        count += 1
        return {
          ok: true,
          data: {
            runId: `run_${String(count)}`,
            missionId: `mission_${input.peer.self.name.toLowerCase()}_${String(count)}`,
            runtime: input.runtime,
            model: input.model ?? 'account-default',
            resolvedRouteId: 'x',
            cliVersion: null,
            sandbox: 'read-only',
            peerMessages: [],
            peerDeliveryFailed: false
          }
        }
      },
      assignOwner: async () => undefined,
      notify: (update) => {
        if (update.kind === 'relay-notice') notices.push(update.message)
      }
    })
    return { relay, starts, notices }
  }
  const wrenAsks = (): SharingMission => ({ ...sharing(), peer: three(WREN) })
  const toBoth = (): WorkroomMessage[] => [message(BOOTY, 'Booty, check the tests.'), message(ATLAS, 'Atlas, check the docs.')]

  it('starts a run for each, and says the next turn is waiting on them', async () => {
    const { relay, starts, notices } = meetingHarness()
    await relay.onShared(wrenAsks(), toBoth())
    expect(starts.map((s) => s.peer.self.name)).toEqual(['Booty', 'Atlas'])
    expect(notices.at(-1)).toBe('Waiting on Booty, Atlas to reply before your next turn.')
  })

  it("holds the first reply, and starts the asker's turn once after the last, briefed with everyone", async () => {
    const { relay, starts, notices } = meetingHarness()
    await relay.onShared(wrenAsks(), toBoth())
    const bootyRun: SharingMission = { ...sharing(), runId: 'run_1', missionId: 'mission_booty_1', peer: three({ ...BOOTY, route: BOOTY_ROUTE }), relay: starts[0]!.relay }
    await relay.onShared(bootyRun, [{ ...message(WREN, 'Tests pass.'), from: { ...BOOTY, missionId: 'mission_booty_1' } } as WorkroomMessage])
    expect(starts).toHaveLength(2)
    expect(notices.at(-1)).toBe('Booty replied. Still waiting on Atlas.')
    const atlasRun: SharingMission = { ...sharing(), runId: 'run_2', missionId: 'mission_atlas_2', peer: three({ ...ATLAS, route: ATLAS_ROUTE }), relay: starts[1]!.relay }
    await relay.onShared(atlasRun, [{ ...message(WREN, 'Docs are stale.'), from: { ...ATLAS, missionId: 'mission_atlas_2' } } as WorkroomMessage])
    expect(starts).toHaveLength(3)
    expect(starts[2]).toMatchObject({ peer: three(WREN), followUpOf: 'mission_wren1' })
    expect(starts[2]?.prompt).toContain('Booty and Atlas replied to your message')
  })

  it('counts a teammate who finishes without replying, and still convenes the rest', async () => {
    const { relay, starts, notices } = meetingHarness()
    await relay.onShared(wrenAsks(), toBoth())
    await relay.onRunEnded({ missionId: 'mission_booty_1', peer: three(BOOTY), relay: starts[0]!.relay })
    expect(notices.at(-1)).toBe('Booty finished without replying. Still waiting on Atlas.')
    const atlasRun: SharingMission = { ...sharing(), runId: 'run_2', missionId: 'mission_atlas_2', peer: three({ ...ATLAS, route: ATLAS_ROUTE }), relay: starts[1]!.relay }
    await relay.onShared(atlasRun, [{ ...message(WREN, 'Docs are stale.'), from: { ...ATLAS, missionId: 'mission_atlas_2' } } as WorkroomMessage])
    expect(starts).toHaveLength(3)
    expect(starts[2]?.prompt).toContain('Atlas replied to your message')
    expect(starts[2]?.prompt).toContain('Booty finished without replying')
  })

  it('says so when nobody replied, and starts nothing', async () => {
    const { relay, starts, notices } = meetingHarness()
    await relay.onShared(wrenAsks(), toBoth())
    await relay.onRunEnded({ missionId: 'mission_booty_1', peer: three(BOOTY), relay: starts[0]!.relay })
    await relay.onRunEnded({ missionId: 'mission_atlas_2', peer: three(ATLAS), relay: starts[1]!.relay })
    expect(starts).toHaveLength(2)
    expect(notices.at(-1)).toBe('Nobody replied. Your message waits with them for their next run.')
  })

  it('one recipient is an ordinary exchange, not a meeting', async () => {
    const { relay, notices } = meetingHarness()
    await relay.onShared(wrenAsks(), [message(BOOTY)])
    expect(notices.some((n) => n.startsWith('Waiting on'))).toBe(false)
  })

  it('names everyone in the minutes', () => {
    expect(meetingPrompt({ repliers: ['Booty', 'Atlas', 'Juno'], silent: [] })).toContain('Booty, Atlas and Juno replied')
    expect(meetingPrompt({ repliers: ['Booty'], silent: ['Atlas'] })).toContain('Atlas finished without replying')
  })
})
