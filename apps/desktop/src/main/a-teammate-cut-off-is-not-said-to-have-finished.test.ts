import type { WorkroomMessage } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import type { CodexMissionStartResponse, CodexMissionUpdate } from '../shared/ipc.js'
import { howTurnEnded } from './handoff.js'
import { createRelay } from './relay.js'
import type { RelayOptions, RelayedMessage, SharingMission } from './relay.js'
import type { MissionPeerContext } from './workroom-briefing.js'

/*
 * A TEAMMATE CUT OFF IS NOT SAID TO HAVE FINISHED (0.572).
 *
 * Colin's ledger, 2026-10-03: Bro asked Codex to find a session-switch
 * stall. Codex measured for a while, then hit its 5-hour usage limit and
 * the run failed. Bro's thread said "Codex finished without writing back".
 * It had not finished. And had Bro's message asked for an answer, Codex's
 * last progress line ("I'll test reducing off-screen prose layout first")
 * would have been brought back as the answer.
 */

const CODEX = { teammateId: 'tm_codex', name: 'Codex', role: 'Code & Migrations' }
const BRO = { teammateId: 'tm_bro', name: 'Bro', role: 'Chief of Staff' }
const codexPeer: MissionPeerContext = { self: { ...CODEX, route: { runtime: 'codex', model: 'gpt-6.1-sol', mode: 'auto' } }, others: [BRO] }
const broPeer: MissionPeerContext = { self: { ...BRO, route: { runtime: 'antigravity', model: 'gemini-3.8-flash', mode: 'auto' } }, others: [CODEX] }

const fromBro: SharingMission = { runId: 'run_bro', missionId: 'mission_bro', runtime: 'antigravity', sandbox: 'workspace-write', model: 'gemini-3.8-flash', peer: broPeer, relay: undefined }
const toCodex = (text: string, extra: Partial<RelayedMessage> = {}): RelayedMessage => ({
  messageId: 'msg_1',
  sequence: 1,
  from: { teammateId: BRO.teammateId, name: BRO.name, missionId: 'mission_bro' },
  to: { teammateId: CODEX.teammateId, name: CODEX.name },
  text,
  postedAt: '2026-10-03T21:14:00.000Z',
  ...extra
}) as WorkroomMessage & RelayedMessage

const failedOnLimit = [{ type: 'run.failed', payload: { kind: 'quota-exhausted', message: 'You have hit your usage limit.' } }]
const completed = [{ type: 'run.completed', payload: {} }]

function harness(ending: readonly { readonly type: string; readonly payload?: unknown }[]) {
  const starts: Parameters<RelayOptions['start']>[0][] = []
  const posts: unknown[] = []
  const notices: CodexMissionUpdate[] = []
  const relay = createRelay({
    enabled: async () => true,
    peerContextFor: async (id) => (id === CODEX.teammateId ? codexPeer : id === BRO.teammateId ? broPeer : undefined),
    finalReplyOf: async () => "The baseline points to layout. I'll test reducing off-screen prose layout first.",
    howEnded: async () => howTurnEnded(ending),
    post: async (message) => {
      posts.push(message)
      return { messageId: `wm_${String(posts.length)}` }
    },
    start: async (request) => {
      starts.push(request)
      return {
        ok: true,
        data: { runId: `run_${String(starts.length)}`, missionId: `mission_${String(starts.length)}`, runtime: request.runtime, model: request.model ?? 'x', resolvedRouteId: 'x', cliVersion: null, sandbox: 'read-only', peerMessages: [], peerDeliveryFailed: false }
      } as CodexMissionStartResponse
    },
    assignOwner: async () => undefined,
    notify: (update) => void notices.push(update)
  })
  const said = (): string[] => notices.flatMap((update) => (update.kind === 'relay-notice' ? [update.message] : []))
  return { relay, starts, posts, said }
}

describe('a teammate whose run did not complete', () => {
  it('is said to have stopped, and why, not to have finished', async () => {
    const h = harness(failedOnLimit)
    await h.relay.onShared(fromBro, [toCodex('Profile the session switch and fix the stall.')])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: codexPeer, relay: undefined })
    expect(h.said().at(-1)).toBe('Codex stopped before writing back: its usage limit was reached. Anything they said is in their own conversation.')
    expect(h.said().join('\n')).not.toMatch(/finished/)
  })

  it('has no answer brought back, even when one was asked for', async () => {
    const h = harness(failedOnLimit)
    await h.relay.onShared(fromBro, [toCodex('Where is the stall?', { wantsAnswer: true })])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: codexPeer, relay: undefined })
    expect(h.posts).toEqual([])
    expect(h.starts.map((start) => start.peer.self.name)).toEqual(['Codex'])
    expect(h.said().at(-1)).toMatch(/^Codex stopped before writing back: its usage limit was reached\./)
  })

  it('stopped by the person is said so', async () => {
    const h = harness([{ type: 'run.cancelled', payload: {} }])
    await h.relay.onShared(fromBro, [toCodex('Profile the session switch.')])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: codexPeer, relay: undefined })
    expect(h.said().at(-1)).toBe('Codex stopped before writing back: the person stopped it. Anything they said is in their own conversation.')
  })
})

describe('a teammate whose run completed', () => {
  it('is still said to have finished without writing back', async () => {
    const h = harness(completed)
    await h.relay.onShared(fromBro, [toCodex('The build is green.')])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: codexPeer, relay: undefined })
    expect(h.said().at(-1)).toBe('Codex finished without writing back. Anything they said is in their own conversation.')
  })

  it('still has its answer brought back', async () => {
    const h = harness(completed)
    await h.relay.onShared(fromBro, [toCodex('Where is the stall?', { wantsAnswer: true })])
    await h.relay.onRunEnded({ missionId: 'mission_1', peer: codexPeer, relay: undefined })
    expect(h.posts).toHaveLength(1)
  })
})
