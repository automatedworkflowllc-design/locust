import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate } from '../shared/ipc.js'
import { parseShareBlocks } from '../shared/peer-share.js'
import { RETURNED_ANSWER, createRelay, returnedAnswerPrompt } from './relay.js'
import type { RelayOptions, RelayedMessage, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/*
 * AN ANSWER NOT WRITTEN BACK IS BROUGHT BACK (A2.1).
 *
 * Colin, 2026-09-05: "wren answered it but only in his own chat, we never
 * got the reply in booty's chat". When a message asked for an answer and the
 * recipient answered in prose without a reply block, the host brings the
 * answer to the asker: posted as the answerer's message, labelled returned,
 * and the asker's turn started to take it -- once, even past the hop budget.
 */

const WREN = { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }
const BOOTY = { teammateId: 'tm_booty', name: 'Booty', role: 'Custom' }
const wrenPeer: MissionPeerContext = { self: { ...WREN, route: { runtime: 'cursor', model: 'composer-2.5', mode: 'accept-edits' } }, others: [BOOTY] }
const bootyPeer: MissionPeerContext = { self: { ...BOOTY, route: { runtime: 'claude', model: 'sonnet', mode: 'ask' } }, others: [WREN] }

const sharing = (overrides: Partial<SharingMission> = {}): SharingMission => ({
  runId: 'run_wren1',
  missionId: 'mission_wren1',
  runtime: 'cursor',
  sandbox: 'workspace-write',
  model: 'composer-2.5',
  peer: wrenPeer,
  relay: undefined,
  ...overrides
})
const toBooty = (text: string, extra: Partial<RelayedMessage> = {}): RelayedMessage => ({
  messageId: 'msg_1',
  sequence: 1,
  from: { teammateId: WREN.teammateId, name: WREN.name, missionId: 'mission_wren1' },
  to: { teammateId: BOOTY.teammateId, name: BOOTY.name },
  text,
  postedAt: '2026-09-24T10:00:00.000Z',
  ...extra
}) as WorkroomMessage & RelayedMessage

const BUSY: CodexMissionStartResponse = { ok: false, error: { code: 'RUN_ALREADY_ACTIVE', message: 'Wren already has a mission running.' } }

function harness(input: { readonly finalReply?: string; readonly cap?: number; readonly startResults?: readonly (CodexMissionStartResponse | undefined)[] } = {}) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const posts: { from: unknown; to: unknown; text: string }[] = []
  const notices: CodexMissionUpdate[] = []
  const relay = createRelay({
    enabled: async () => true,
    ...(input.cap === undefined ? {} : { hopCap: async () => input.cap! }),
    peerContextFor: async (id) => (id === WREN.teammateId ? wrenPeer : id === BOOTY.teammateId ? bootyPeer : undefined),
    finalReplyOf: async () => input.finalReply,
    post: async (message) => {
      posts.push(message)
    },
    start: async (request) => {
      starts.push(request)
      const scripted = input.startResults?.[starts.length - 1]
      if (scripted !== undefined) return scripted
      return {
        ok: true,
        data: { runId: `run_${String(starts.length)}`, missionId: `mission_${String(starts.length)}`, runtime: request.runtime, model: request.model ?? 'account-default', resolvedRouteId: 'x', cliVersion: null, sandbox: 'read-only', peerMessages: [], peerDeliveryFailed: false }
      } as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    notify: (update) => void notices.push(update)
  })
  const said = (): string[] => notices.flatMap((update) => (update.kind === 'relay-notice' ? [update.message] : []))
  return { relay, starts, posts, said }
}

describe('a message that wants an answer', () => {
  it('ending in a question, or saying wants="answer", wants one; an FYI does not', () => {
    const [asking, flagged, telling] = parseShareBlocks(
      '<locust-share to="Booty">What is the build command?</locust-share>\n<locust-share to="Booty" wants="answer">Tell me the build command.</locust-share>\n<locust-share to="Booty">The build is green.</locust-share>'
    )
    expect([asking?.wantsAnswer, flagged?.wantsAnswer, telling?.wantsAnswer]).toEqual([true, true, undefined])
  })
})

describe('when the recipient answers without writing back', () => {
  it('the answer is brought back: posted as theirs, labelled, and the asker started to take it', async () => {
    const h = harness({ finalReply: 'The build command is pnpm build.\n<locust-memory>\nremember :: Build with pnpm build.\n</locust-memory>' })
    await h.relay.onShared(sharing(), [toBooty('What is the build command?', { wantsAnswer: true })])
    expect(h.starts.map((start) => start.peer.self.name)).toEqual(['Booty'])

    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: { hop: 1, rootMissionId: 'mission_wren1', lastMissionOf: {} } })
    expect(h.posts).toEqual([
      {
        from: { teammateId: 'tm_booty', name: 'Booty', missionId: 'mission_1' },
        to: { teammateId: 'tm_wren', name: 'Wren' },
        text: `${RETURNED_ANSWER} The build command is pnpm build.`
      }
    ])
    expect(h.starts.map((start) => start.peer.self.name)).toEqual(['Booty', 'Wren'])
    expect(h.starts[1]?.prompt).toBe(returnedAnswerPrompt('Booty'))
    expect(h.starts[1]?.relay.hop).toBe(2)
    expect(h.said().at(-1)).toBe('Booty answered in their own conversation without writing back, so the answer was brought back to Wren.')
    expect(h.said()).not.toContain('Booty finished without writing back. Anything they said is in their own conversation.')
  })

  it('once: the same run ending again brings nothing more', async () => {
    const h = harness({ finalReply: 'pnpm build.' })
    await h.relay.onShared(sharing(), [toBooty('What is the build command?', { wantsAnswer: true })])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: undefined })
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: undefined })
    expect(h.posts).toHaveLength(1)
    expect(h.starts).toHaveLength(2)
  })

  it('an FYI ends as it did: said where the reply is, nothing started', async () => {
    const h = harness({ finalReply: 'Thanks, noted.' })
    await h.relay.onShared(sharing(), [toBooty('The build is green.')])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: undefined })
    expect(h.posts).toEqual([])
    expect(h.starts).toHaveLength(1)
    expect(h.said().at(-1)).toBe('Booty finished without writing back. Anything they said is in their own conversation.')
  })

  it('it closes the exchange, so the hop budget does not refuse it', async () => {
    // Budget of 2; Wren's own run is already the first automatic reply.
    const h = harness({ finalReply: 'pnpm build.', cap: 2 })
    await h.relay.onShared(sharing({ relay: { hop: 1, rootMissionId: 'mission_root', lastMissionOf: {} } }), [toBooty('What is the build command?', { wantsAnswer: true })])
    expect(h.starts).toHaveLength(1)
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: undefined })
    expect(h.starts.map((start) => [start.peer.self.name, start.relay.hop])).toEqual([['Booty', 2], ['Wren', 3]])
  })

  it('an asker still working is held, and started once their run ends', async () => {
    // Busy when the answer comes back, and still busy on the retry any run
    // ending triggers (0.312); free once their own run ends.
    const h = harness({ finalReply: 'pnpm build.', startResults: [undefined, BUSY, BUSY] })
    await h.relay.onShared(sharing(), [toBooty('What is the build command?', { wantsAnswer: true })])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: undefined })
    const waiting = h.starts.length
    expect(h.starts.slice(1).every((start) => start.peer.self.name === 'Wren')).toBe(true)
    await h.relay.onRunEnded({ missionId: 'mission_wren_busy', peer: wrenPeer, relay: undefined })
    expect(h.starts.length).toBe(waiting + 1)
    expect(h.starts.at(-1)?.peer.self.name).toBe('Wren')
    expect(h.starts.at(-1)?.prompt).toBe(returnedAnswerPrompt('Booty'))
  })

  it('nothing to bring back -- an empty reply -- is said as before', async () => {
    const h = harness({ finalReply: '<locust-memory>\nremember :: x.\n</locust-memory>' })
    await h.relay.onShared(sharing(), [toBooty('What is the build command?', { wantsAnswer: true })])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: bootyPeer, relay: undefined })
    expect(h.posts).toEqual([])
    expect(h.said().at(-1)).toBe('Booty finished without writing back. Anything they said is in their own conversation.')
  })
})
