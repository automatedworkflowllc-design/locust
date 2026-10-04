import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionUpdate } from '../shared/ipc.js'
import { createRelay } from './relay.js'
import type { RelayOptions, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * Colin, 2026-09-21: "its kind of messy that each time a teammate messages
 * another that it spawns a new chat in ungrouped ... each teammate has their
 * own isolated chat where the replies go to on the sidebar."
 *
 * `relay.ts` chained a reply onto the recipient's previous mission ONLY
 * within the current exchange's `lastMissionOf`. A later, separate peer
 * message had no entry there, so `followUpOf` was `undefined`, the start made
 * a brand-new root, and the sidebar grew another Ungrouped row. Every peer
 * message after the first was a new conversation by construction.
 */

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom' }
const BOOTY_ROUTE = { runtime: 'claude' as const, model: 'sonnet', mode: 'ask' as const }
const wrenPeer: MissionPeerContext = { self: WREN, others: [BOOTY] }
const bootyPeer: MissionPeerContext = { self: { ...BOOTY, route: BOOTY_ROUTE }, others: [WREN] }

function message(text = 'What is the build command?'): WorkroomMessage {
  return {
    messageId: 'msg_booty',
    sequence: 1,
    from: { teammateId: WREN.teammateId, name: WREN.name, missionId: 'mission_wren1' },
    to: BOOTY,
    text,
    postedAt: '2026-09-21T10:00:00.000Z'
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

function harness(options: { hub?: string; withHub?: boolean } = {}) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const notices: CodexMissionUpdate[] = []
  const remembered: { teammateId: string; missionId: string; began: boolean }[] = []
  const relay = createRelay({
    enabled: async () => true,
    peerContextFor: async (id) => (id === BOOTY.teammateId ? bootyPeer : id === WREN.teammateId ? wrenPeer : undefined),
    start: async (input) => {
      starts.push(input)
      return {
        ok: true,
        data: {
          runId: `run_${String(starts.length)}`,
          missionId: `mission_${String(starts.length)}`,
          runtime: input.runtime,
          model: input.model ?? 'account-default',
          resolvedRouteId: 'claude-account:default',
          cliVersion: null,
          sandbox: 'read-only',
          peerMessages: [],
          peerDeliveryFailed: false
        }
      }
    },
    assignOwner: async () => undefined,
    notify: (update) => notices.push(update),
    ...(options.withHub === false
      ? {}
      : {
          hubOf: async (teammateId) => (teammateId === BOOTY.teammateId ? options.hub : undefined),
          rememberHub: async (teammateId, missionId, began) => {
            remembered.push({ teammateId, missionId, began })
          }
        })
  })
  return { relay, starts, notices, remembered }
}

describe('a reply outside an exchange lands in the hub', () => {
  it('continues the hub when the recipient has no turn in this exchange', async () => {
    const { relay, starts, remembered, notices } = harness({ hub: 'mission_hub_latest' })
    await relay.onShared(sharing(), [message()])
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ peer: bootyPeer, followUpOf: 'mission_hub_latest' })
    // The run is the hub's newest turn now, and the window is told which.
    expect(remembered).toEqual([{ teammateId: BOOTY.teammateId, missionId: 'mission_1', began: false }])
    const started = notices.find((update) => update.kind === 'mission-started')
    expect(started).toMatchObject({ kind: 'mission-started', hubMissionId: 'mission_1' })
  })

  it('begins a hub for a teammate who has none, and says it began', async () => {
    const { relay, starts, remembered } = harness({ hub: undefined })
    await relay.onShared(sharing(), [message()])
    expect(starts[0]).toMatchObject({ followUpOf: undefined })
    expect(remembered).toEqual([{ teammateId: BOOTY.teammateId, missionId: 'mission_1', began: true }])
  })

  it("a turn inside an exchange still continues the exchange, and leaves the hub alone", async () => {
    // Booty already spoke in this exchange: the reply chains onto THAT turn,
    // as it did before hubs existed. The hub is for replies with nowhere
    // else to go, not a magnet for every reply.
    const { relay, starts, remembered, notices } = harness({ hub: 'mission_hub_latest' })
    const wrenAgain = sharing({
      runId: 'run_wren2',
      missionId: 'mission_wren2',
      relay: { hop: 2, lastMissionOf: { tm_wren: 'mission_wren1', tm_booty: 'mission_booty' } }
    })
    await relay.onShared(wrenAgain, [message('One more thing.')])
    expect(starts[0]).toMatchObject({ followUpOf: 'mission_booty' })
    expect(remembered).toEqual([])
    const started = notices.find((update) => update.kind === 'mission-started')
    expect(started).toBeDefined()
    expect(started !== undefined && 'hubMissionId' in started ? started.hubMissionId : undefined).toBeUndefined()
  })

  it('without a hub reader, behaves exactly as before: every such reply is a new root', async () => {
    const { relay, starts, remembered } = harness({ withHub: false })
    await relay.onShared(sharing(), [message()])
    expect(starts[0]).toMatchObject({ followUpOf: undefined })
    expect(remembered).toEqual([])
  })
})
