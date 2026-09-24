import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate } from '../shared/ipc.js'
import { createRelay, saysNothingIsNeeded } from './relay.js'
import { exchangeOfRoomPost } from './room-store.js'
import type { PublicRoom } from '../shared/ipc.js'
import type { RelayOptions, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/**
 * A2.3 AND A2.4: THE AUTOMATIC-REPLY BUDGET, COUNTED RIGHT.
 *
 * - Spent at the decision: two replies decided in the seconds a start takes
 *   both read the same count and both ran.
 * - Told as the exchange's number: a reply on a second branch was told the
 *   depth of its own chain.
 * - One budget per room post, not one per member.
 * - A message that says its recipient need do nothing starts nothing (the
 *   0.312 relay drive: "No further action is needed from you" cost a run).
 */
const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom', route: { runtime: 'claude' as const, model: 'haiku', mode: 'ask' as const } }
const NOVA = { teammateId: 'tm_nova', name: 'Nova', role: 'Docs & QA', route: { runtime: 'claude' as const, model: 'haiku', mode: 'ask' as const } }
const peers: Record<string, MissionPeerContext> = {
  tm_wren: { self: { ...WREN, route: { runtime: 'claude', model: 'haiku', mode: 'ask' } }, others: [BOOTY, NOVA] },
  tm_booty: { self: BOOTY, others: [WREN, NOVA] },
  tm_nova: { self: NOVA, others: [WREN, BOOTY] }
}

function message(from: { teammateId: string; name: string }, to: { teammateId: string; name: string }, text: string, extra: Record<string, unknown> = {}): WorkroomMessage {
  return { messageId: `wm_${from.teammateId}_${to.teammateId}`, sequence: 1, from: { ...from, missionId: 'm' }, to, text, postedAt: '2026-09-24T17:00:00.000Z', ...extra } as WorkroomMessage
}

function sharing(missionId: string, sender: MissionPeerContext, relay?: SharingMission['relay']): SharingMission {
  return { runId: `run_${missionId}`, missionId, runtime: 'claude', sandbox: 'read-only', model: 'haiku', peer: sender, relay }
}

function harness(input: { cap: number; exchangeOf?: RelayOptions['exchangeOf']; results?: readonly (CodexMissionStartResponse | undefined)[] }) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const notices: string[] = []
  const relay = createRelay({
    enabled: async () => true,
    hopCap: async () => input.cap,
    ...(input.exchangeOf === undefined ? {} : { exchangeOf: input.exchangeOf }),
    // A2.1's return path: the recipient's last words, posted as theirs.
    finalReplyOf: async () => 'The build command is pnpm check.',
    post: async (posted) => ({ messageId: 'wm_returned', sequence: 99, ...posted, postedAt: '2026-09-24T17:05:00.000Z' }) as WorkroomMessage,
    peerContextFor: async (teammateId) => peers[teammateId],
    start: async (request) => {
      starts.push(request)
      // A start takes time: the window every overlap lived in.
      await new Promise((resolve) => setTimeout(resolve, 5))
      return input.results?.[starts.length - 1] ?? {
        ok: true,
        data: {
          runId: `run_${String(starts.length)}`,
          missionId: `mission_${String(starts.length)}`,
          runtime: request.runtime,
          model: request.model ?? 'account-default',
          resolvedRouteId: 'claude',
          cliVersion: null,
          sandbox: 'read-only',
          peerMessages: [],
          peerDeliveryFailed: false
        }
      }
    },
    assignOwner: async () => undefined,
    notify: (update: CodexMissionUpdate) => {
      if (update.kind === 'relay-notice') notices.push(update.message)
    }
  })
  return { relay, starts, notices }
}

describe('the budget is spent at the decision', () => {
  it('lets only one of two replies decided at the same moment through the last slot', async () => {
    const { relay, starts, notices } = harness({ cap: 2 })
    // The exchange has spent one already.
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, BOOTY, 'What is the build command?')])
    expect(starts).toHaveLength(1)
    const branch = { hop: 1, rootMissionId: 'mission_root', lastMissionOf: { tm_wren: 'mission_root' } }
    // Two replies in one exchange, decided together, one slot left.
    await Promise.all([
      relay.onShared(sharing('mission_b', peers.tm_booty!, branch), [message(BOOTY, NOVA, 'Nova, what does the lint step run?')]),
      relay.onShared(sharing('mission_c', peers.tm_nova!, branch), [message(NOVA, BOOTY, 'Booty, which test is failing?')])
    ])
    expect(starts).toHaveLength(2)
    expect(notices.some((line) => line.startsWith('Stopped after 2 automatic replies'))).toBe(true)
  })

  it('gives the count back when no run comes of the decision', async () => {
    const refused: CodexMissionStartResponse = { ok: false, error: { code: 'RUNTIME_START_FAILED', message: 'No runtime.' } }
    const { relay, starts } = harness({ cap: 1, results: [refused] })
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, BOOTY, 'What is the build command?')])
    // The refused start spent nothing, so the one slot is still there.
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, NOVA, 'What does lint run?')])
    expect(starts).toHaveLength(2)
  })
})

describe('the budget is one per room post', () => {
  const exchangeOf = async (missionId: string): Promise<string | undefined> => (missionId === 'mission_wren' || missionId === 'mission_nova' ? 'room:r1:p1' : undefined)

  it('is found from the room store: every mission of one post, one key', () => {
    const rooms = [
      { roomId: 'r1', posts: [{ postId: 'p1', missions: { tm_wren: 'mission_wren', tm_nova: 'mission_nova' } }, { postId: 'p2', missions: { tm_wren: 'mission_later' } }] }
    ] as unknown as readonly PublicRoom[]
    expect(exchangeOfRoomPost(rooms, 'mission_wren')).toBe('room:r1:p1')
    expect(exchangeOfRoomPost(rooms, 'mission_nova')).toBe('room:r1:p1')
    expect(exchangeOfRoomPost(rooms, 'mission_later')).toBe('room:r1:p2')
    expect(exchangeOfRoomPost(rooms, 'mission_elsewhere')).toBeUndefined()
  })

  it('counts every member of the post against one budget', async () => {
    const { relay, starts, notices } = harness({ cap: 1, exchangeOf })
    // Two members answering the same post, each writing to a colleague.
    await relay.onShared(sharing('mission_wren', peers.tm_wren!), [message(WREN, BOOTY, 'Booty, what is the build command?')])
    await relay.onShared(sharing('mission_nova', peers.tm_nova!), [message(NOVA, BOOTY, 'Booty, which test is failing?')])
    expect(starts).toHaveLength(1)
    expect(notices.some((line) => line.startsWith('Stopped after 1 automatic reply'))).toBe(true)
    expect(starts[0]?.relay.rootMissionId).toBe('room:r1:p1')
  })

  it('tells a held reply the number it is when it starts, not when it was held', async () => {
    const busy: CodexMissionStartResponse = { ok: false, error: { code: 'RUN_ALREADY_ACTIVE', message: 'Booty is busy.' } }
    const { relay, starts } = harness({ cap: 6, exchangeOf, results: [busy] })
    // Held: Booty is mid-run when Wren writes.
    await relay.onShared(sharing('mission_wren', peers.tm_wren!), [message(WREN, BOOTY, 'Booty, what is the build command?')])
    // Meanwhile the post's other member spends a reply.
    await relay.onShared(sharing('mission_nova', peers.tm_nova!), [message(NOVA, WREN, 'Wren, which test is failing?')])
    // Booty's run ends; the held reply starts now, second in the exchange.
    await relay.onRunEnded({ missionId: 'mission_booty_before', peer: peers.tm_booty, relay: undefined })
    const held = starts.filter((entry) => entry.peer.self.teammateId === 'tm_booty').at(-1)
    expect(held?.prompt).toContain('This is automatic reply 2 of 6.')
  })

  it('counts a held reply when it starts, so the budget still binds after it', async () => {
    const busy: CodexMissionStartResponse = { ok: false, error: { code: 'RUN_ALREADY_ACTIVE', message: 'Booty is busy.' } }
    const { relay, starts, notices } = harness({ cap: 2, exchangeOf, results: [busy] })
    await relay.onShared(sharing('mission_wren', peers.tm_wren!), [message(WREN, BOOTY, 'Booty, what is the build command?')])
    await relay.onShared(sharing('mission_nova', peers.tm_nova!), [message(NOVA, WREN, 'Wren, which test is failing?')])
    // The held reply starts: the exchange has now spent both.
    await relay.onRunEnded({ missionId: 'mission_booty_before', peer: peers.tm_booty, relay: undefined })
    const before = starts.length
    await relay.onShared(sharing('mission_nova', peers.tm_nova!), [message(NOVA, BOOTY, 'Booty, and the lint step?')])
    expect(starts).toHaveLength(before)
    expect(notices.some((line) => line.startsWith('Stopped after 2 automatic replies'))).toBe(true)
  })

  it('tells each reply its number in the exchange, not the depth of its chain', async () => {
    const { relay, starts } = harness({ cap: 6, exchangeOf })
    await relay.onShared(sharing('mission_wren', peers.tm_wren!), [message(WREN, BOOTY, 'Booty, what is the build command?')])
    await relay.onShared(sharing('mission_nova', peers.tm_nova!), [message(NOVA, BOOTY, 'Booty, which test is failing?')])
    expect(starts[0]?.prompt).toContain('This is automatic reply 1 of 6.')
    // Hop one of its own chain, and the second reply of the exchange.
    expect(starts[1]?.prompt).toContain('This is automatic reply 2 of 6.')
  })
})

describe('a message that says its recipient need do nothing', () => {
  it('is read the way it was meant', () => {
    expect(saysNothingIsNeeded('The request is closed. No further action is needed from you.')).toBe(true)
    expect(saysNothingIsNeeded("You don't need to do anything with this.")).toBe(true)
    // The recipient's own "from me" is an answer being given, not a closing.
    expect(saysNothingIsNeeded('TANGERINE. Nothing further is needed from me on this turn.')).toBe(false)
    // Asking for something makes it a request, whatever else it says.
    expect(saysNothingIsNeeded('Please fix the flaky test. No further action is needed from you after that.')).toBe(false)
    expect(saysNothingIsNeeded('No further action is needed from you -- or is there?')).toBe(false)
    // A reply is not work: "no reply needed" can come with a job.
    expect(saysNothingIsNeeded('Rename the helper to fetchAll. No reply needed.')).toBe(false)
  })

  it('is delivered without starting a run, and says why', async () => {
    const { relay, starts, notices } = harness({ cap: 6 })
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, BOOTY, 'The build is green. No further action is needed from you.')])
    expect(starts).toHaveLength(0)
    expect(notices).toContain('Sent to Booty to read on their next run: the message says nothing more is needed from them.')
  })

  it('still starts the run of the teammate whose conversation the person is reading', async () => {
    const { relay, starts } = harness({ cap: 6 })
    // Booty answers Wren, the person's teammate: that run is how the person hears.
    const branch = { hop: 1, rootMissionId: 'mission_root', lastMissionOf: { tm_wren: 'mission_root' } }
    await relay.onShared(sharing('mission_b', peers.tm_booty!, branch), [message(BOOTY, WREN, 'TANGERINE. No further action is needed from you.')])
    expect(starts).toHaveLength(1)
    expect(starts[0]?.peer.self.teammateId).toBe('tm_wren')
  })

  it('still starts one that wants an answer', async () => {
    const { relay, starts } = harness({ cap: 6 })
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, BOOTY, 'No further action is needed from you.', { wantsAnswer: true })])
    expect(starts).toHaveLength(1)
  })
})

describe('every run the relay starts is counted', () => {
  it('counts the turn of the asker that closes a meeting', async () => {
    const { relay, starts, notices } = harness({ cap: 3 })
    // A question to two teammates is a meeting: both reply, then Wren's turn.
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, BOOTY, 'Booty, the build command?'), message(WREN, NOVA, 'Nova, the lint step?')])
    const branch = { hop: 1, rootMissionId: 'mission_root', lastMissionOf: { tm_wren: 'mission_root' } }
    await relay.onShared(sharing('mission_1', peers.tm_booty!, branch), [message(BOOTY, WREN, 'pnpm check.')])
    await relay.onShared(sharing('mission_2', peers.tm_nova!, branch), [message(NOVA, WREN, 'eslint.')])
    expect(starts.map((entry) => entry.peer.self.teammateId)).toEqual(['tm_booty', 'tm_nova', 'tm_wren'])
    // Three spent of three: the next reply in the exchange stops.
    await relay.onShared(sharing('mission_3', peers.tm_wren!, { hop: 2, rootMissionId: 'mission_root', lastMissionOf: { tm_wren: 'mission_root' } }), [message(WREN, BOOTY, 'Booty, one more thing: the test command?')])
    expect(starts).toHaveLength(3)
    expect(notices.some((line) => line.startsWith('Stopped after 3 automatic replies'))).toBe(true)
  })

  it('counts the turn an answer brought back starts', async () => {
    const { relay, starts, notices } = harness({ cap: 2 })
    // Wren asks; Booty answers in its own conversation and ends without writing back.
    await relay.onShared(sharing('mission_root', peers.tm_wren!), [message(WREN, BOOTY, 'Booty, what is the build command?', { wantsAnswer: true })])
    await relay.onRunEnded({ missionId: 'mission_1', peer: peers.tm_booty, relay: { hop: 1, rootMissionId: 'mission_root', lastMissionOf: { tm_wren: 'mission_root' } } })
    expect(starts.map((entry) => entry.peer.self.teammateId)).toEqual(['tm_booty', 'tm_wren'])
    // Two spent of two -- asked from a shallow branch, so the depth of its
    // own chain (1) cannot be what stops it.
    await relay.onShared(sharing('mission_2', peers.tm_nova!, { hop: 1, rootMissionId: 'mission_root', lastMissionOf: { tm_wren: 'mission_root' } }), [message(NOVA, BOOTY, 'Booty, and the test command?')])
    expect(starts).toHaveLength(2)
    expect(notices.some((line) => line.startsWith('Stopped after 2 automatic replies'))).toBe(true)
  })
})
