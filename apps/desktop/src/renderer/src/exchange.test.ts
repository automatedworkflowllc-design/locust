import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import type { PublicPeerMessage } from '../../shared/ipc.js'
import { exchangeOf } from './exchange.js'
import type { ExchangeMission } from './exchange.js'

const AT = '2026-09-05T04:00:00.000Z'

function message(
  messageId: string,
  direction: 'posted' | 'received',
  from: [string, string],
  to: [string, string]
): PublicPeerMessage {
  return {
    messageId,
    direction,
    from: { teammateId: from[0], name: from[1] },
    to: { teammateId: to[0], name: to[1] },
    text: 'hello',
    at: AT
  }
}

function completed(usd: number): NormalizedRuntimeEvent {
  return {
    id: `done-${String(usd)}`,
    runId: 'run',
    missionId: 'mission',
    sequence: 1,
    type: 'run.completed',
    occurredAt: AT,
    sourceAdapter: 'claude',
    payload: { usage: { total_cost_usd: usd }, process: {}, evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent
}

function mission(overrides: Partial<ExchangeMission> & { readonly missionId: string }): ExchangeMission {
  return {
    runtime: 'codex',
    model: 'account-default',
    events: [],
    peerMessages: [],
    live: false,
    ...overrides
  }
}

const WREN: [string, string] = ['tm_wren', 'Wren']
const BOOTY: [string, string] = ['tm_booty', 'Booty']
const ATLAS: [string, string] = ['tm_atlas', 'Atlas']

describe('the exchange a conversation is part of', () => {
  it('is nothing for a conversation that talked to nobody', () => {
    expect(exchangeOf('m1', [mission({ missionId: 'm1' })])).toBeUndefined()
  })

  it('links two missions by the message one posted and the other received', () => {
    const wren = mission({
      missionId: 'm_wren',
      runtime: 'cursor',
      model: 'auto',
      teammateId: 'tm_wren',
      teammateName: 'Wren',
      peerMessages: [message('wm_1', 'posted', WREN, BOOTY)]
    })
    const booty = mission({
      missionId: 'm_booty',
      runtime: 'claude',
      model: 'claude/sonnet',
      teammateId: 'tm_booty',
      teammateName: 'Booty',
      startedBy: { kind: 'relay', hop: 1 },
      peerMessages: [message('wm_1', 'received', WREN, BOOTY)],
      live: true,
      runId: 'run_booty'
    })
    const overview = exchangeOf('m_wren', [wren, booty])
    expect(overview).toBeDefined()
    expect(overview!.participants.map((p) => [p.name, p.runtime, p.model, p.live])).toEqual([
      ['Wren', 'cursor', 'auto', false],
      ['Booty', 'claude', 'claude/sonnet', true]
    ])
    expect(overview!.hops).toBe(1)
    expect(overview!.liveRunIds).toEqual(['run_booty'])
    expect([...overview!.missionIds].sort()).toEqual(['m_booty', 'm_wren'])
  })

  it('reaches a third teammate through the second, and takes the deepest hop', () => {
    const wren = mission({ missionId: 'm_wren', teammateId: 'tm_wren', teammateName: 'Wren', peerMessages: [message('wm_1', 'posted', WREN, BOOTY)] })
    const booty = mission({
      missionId: 'm_booty',
      teammateId: 'tm_booty',
      teammateName: 'Booty',
      startedBy: { kind: 'relay', hop: 1 },
      peerMessages: [message('wm_1', 'received', WREN, BOOTY), message('wm_2', 'posted', BOOTY, ATLAS)]
    })
    const atlas = mission({
      missionId: 'm_atlas',
      teammateId: 'tm_atlas',
      teammateName: 'Atlas',
      startedBy: { kind: 'relay', hop: 2 },
      peerMessages: [message('wm_2', 'received', BOOTY, ATLAS)]
    })
    // Unrelated: a mission that shares no message id stays out.
    const stranger = mission({ missionId: 'm_other', teammateId: 'tm_wren', peerMessages: [message('wm_9', 'posted', WREN, BOOTY)] })
    const overview = exchangeOf('m_atlas', [wren, booty, atlas, stranger])
    expect(overview!.participants.map((p) => p.name).sort()).toEqual(['Atlas', 'Booty', 'Wren'])
    expect(overview!.hops).toBe(2)
    expect(overview!.missionIds).not.toContain('m_other')
  })

  it('adds up what every run in the exchange cost', () => {
    const wren = mission({ missionId: 'm_wren', teammateId: 'tm_wren', events: [completed(0.2)], peerMessages: [message('wm_1', 'posted', WREN, BOOTY)] })
    const booty = mission({ missionId: 'm_booty', teammateId: 'tm_booty', events: [completed(0.25)], peerMessages: [message('wm_1', 'received', WREN, BOOTY)] })
    const overview = exchangeOf('m_wren', [wren, booty])
    expect(overview!.cost?.usd).toBeCloseTo(0.45, 5)
  })

  it('folds one teammate’s several turns into one participant, on their latest route', () => {
    const first = mission({ missionId: 'm_w1', teammateId: 'tm_wren', teammateName: 'Wren', runtime: 'cursor', model: 'auto', peerMessages: [message('wm_1', 'posted', WREN, BOOTY)] })
    const reply = mission({ missionId: 'm_b', teammateId: 'tm_booty', teammateName: 'Booty', peerMessages: [message('wm_1', 'received', WREN, BOOTY), message('wm_2', 'posted', BOOTY, WREN)] })
    const second = mission({ missionId: 'm_w2', teammateId: 'tm_wren', teammateName: 'Wren', runtime: 'claude', model: 'claude/fable', peerMessages: [message('wm_2', 'received', BOOTY, WREN)] })
    const overview = exchangeOf('m_w1', [first, reply, second])
    const wren = overview!.participants.find((p) => p.name === 'Wren')!
    expect(wren.missionIds).toEqual(['m_w1', 'm_w2'])
    expect([wren.runtime, wren.model]).toEqual(['claude', 'claude/fable'])
  })

  it('names a conversation of nobody’s as such, rather than dropping it', () => {
    const nobody = mission({ missionId: 'm_n', peerMessages: [message('wm_1', 'posted', ['', 'Nobody'], BOOTY)] })
    const booty = mission({ missionId: 'm_b', teammateId: 'tm_booty', teammateName: 'Booty', peerMessages: [message('wm_1', 'received', ['', 'Nobody'], BOOTY)] })
    const overview = exchangeOf('m_b', [nobody, booty])
    expect(overview!.participants.map((p) => p.name).sort()).toEqual(['Booty', 'Nobody'])
  })
})
