import { describe, expect, it } from 'vitest'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { withMessageDelta, withMessageDeltas } from '../../shared/messageFragments.js'
import { streamedUpdates } from '../../shared/streamed-updates.js'
import { cappedLiveEvents } from './missionView.js'

const delta = (sequence: number, text: string, itemId = 'answer', operation: 'append' | 'replace' = 'append', final = false): NormalizedRuntimeEvent => ({
  id: `run:${String(sequence)}`, runId: 'run', missionId: 'mission', sequence,
  occurredAt: '2026-10-05T12:00:00.000Z', type: 'message.delta', sourceAdapter: 'codex',
  payload: { itemId, text, operation, final, evidence: { redacted: true } }
})

describe('a streamed batch keeps the whole answer', () => {
  it('matches the live cap after each fragment when an evicted message speaks again in the same batch', () => {
    const held = [delta(1, 'first', 'first'), delta(2, 'old', 'old')]
    const arrivals = [delta(3, 'three', 'third'), delta(4, 'four', 'fourth'), delta(5, 'new', 'old')]
    const expected = arrivals.reduce((events, event) => cappedLiveEvents(withMessageDelta(events, event), 3), held as readonly NormalizedRuntimeEvent[])
    expect(withMessageDeltas(held, arrivals, 3)).toEqual(expected)
    expect(withMessageDeltas(held, arrivals, 3).map((event) => event.id)).toEqual(['run:1', 'run:4', 'run:5'])
  })

  it('sends one message for consecutive deltas, retaining every identity and activity boundary', () => {
    const a = delta(1, 'hello ')
    const b = delta(2, 'world')
    const activity: NormalizedRuntimeEvent = { ...delta(3, ''), type: 'step.started', payload: { stepKind: 'turn', evidence: { redacted: true } } }
    const c = delta(4, '!')
    expect(streamedUpdates('run', 'mission', [a, b, activity, c])).toEqual([
      { kind: 'message-deltas', runId: 'run', missionId: 'mission', events: [a, b] },
      { kind: 'event', runId: 'run', missionId: 'mission', event: activity },
      { kind: 'message-deltas', runId: 'run', missionId: 'mission', events: [c] }
    ])
    expect(streamedUpdates('run', 'mission', [])).toEqual([])
  })

  it('folds append, replace, final and several messages exactly as individual arrivals do without changing inputs', () => {
    const held = [delta(1, 'old'), delta(2, 'another', 'other')]
    const before = structuredClone(held)
    const arrivals = [delta(3, 'new', 'answer', 'replace'), delta(4, ' text'), delta(5, ' done', 'other', 'append', true)]
    const expected = arrivals.reduce((events, event) => withMessageDelta(events, event), held as readonly NormalizedRuntimeEvent[])
    expect(withMessageDeltas(held, arrivals)).toEqual(expected)
    expect(withMessageDeltas(held, arrivals).map((event) => event.type === 'message.delta' ? event.payload.text : '')).toEqual(['new text', 'another done'])
    expect(held).toEqual(before)
    expect(arrivals[0]?.sequence).toBe(3)
  })

  it('keeps the first identity and the complete text of a thousand fragments in a single folded message', () => {
    const arrivals = Array.from({ length: 1_000 }, (_, index) => delta(index + 1, `word${String(index)} `))
    const shown = withMessageDeltas([], arrivals)
    expect(shown).toHaveLength(1)
    expect(shown[0]?.id).toBe('run:1')
    expect(shown[0]?.type === 'message.delta' && shown[0].payload.text).toBe(arrivals.map((event) => event.type === 'message.delta' ? event.payload.text : '').join(''))
  })
})
