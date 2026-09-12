import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { joinMessageFragments, withMessageDelta } from './messageFragments.js'

const NOW = '2026-09-11T22:00:00.000Z'

function fragment(sequence: number, text: string, final = false, itemId = 'msg_0'): NormalizedRuntimeEvent {
  return {
    id: `event_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    type: 'message.delta',
    occurredAt: NOW,
    sourceAdapter: 'cursor',
    payload: { itemId, operation: 'append', text, final, evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent
}

function tool(sequence: number): NormalizedRuntimeEvent {
  return {
    id: `event_${sequence}`,
    runId: 'run_1',
    missionId: 'mission_1',
    sequence,
    type: 'tool.started',
    occurredAt: NOW,
    sourceAdapter: 'cursor',
    payload: { itemId: `tool_${sequence}`, name: 'Read', evidence: { redacted: true } }
  } as unknown as NormalizedRuntimeEvent
}

const textOf = (events: readonly NormalizedRuntimeEvent[]): string =>
  events
    .filter((event) => event.type === 'message.delta')
    .map((event) => (event.payload as { text: string }).text)
    .join('')

describe('a reply is one thing that happened', () => {
  /*
   * The live half of the defect Colin watched: "im currently watching it eat
   * text from the beginning", then the proof of the cause -- "the text seems
   * to go back to normal after they are done", because a finished run is
   * re-read from the record.
   *
   * The renderer keeps the newest 500 events while a run is live. A reply of
   * 1200 fragments therefore pushed its own beginning out of the window
   * while it was still being written.
   */
  it('keeps the front of a reply longer than the live window, as it arrives', () => {
    let events: readonly NormalizedRuntimeEvent[] = []
    for (let index = 0; index < 1200; index += 1) {
      events = withMessageDelta(events, fragment(index + 1, `w${index} `)).slice(-500)
    }
    expect(textOf(events)).toMatch(/^w0 w1 w2 /)
    expect(textOf(events)).toBe(Array.from({ length: 1200 }, (_, index) => `w${index} `).join(''))
    // One reply is one event, which is what makes the cap safe rather than
    // merely generous.
    expect(events).toHaveLength(1)
  })

  it('folds a fragment into its own message even when a tool ran between them', () => {
    let events: readonly NormalizedRuntimeEvent[] = [fragment(1, 'before ')]
    events = withMessageDelta(events, tool(2))
    events = withMessageDelta(events, fragment(3, 'after'))
    expect(events).toHaveLength(2)
    expect(textOf(events)).toBe('before after')
  })

  it('starts a new event for a new message, and keeps them in order', () => {
    let events: readonly NormalizedRuntimeEvent[] = []
    for (const event of [fragment(1, 'first '), fragment(2, 'one'), fragment(3, 'second ', false, 'msg_1'), fragment(4, 'two', true, 'msg_1')]) {
      events = withMessageDelta(events, event)
    }
    expect(events.map((event) => (event.payload as { text: string }).text)).toEqual(['first one', 'second two'])
  })

  it('honours a replace, and carries the latest final', () => {
    let events: readonly NormalizedRuntimeEvent[] = [fragment(1, 'draft')]
    events = withMessageDelta(events, {
      ...fragment(2, 'final answer'),
      payload: { itemId: 'msg_0', operation: 'replace', text: 'final answer', final: true, evidence: { redacted: true } }
    } as unknown as NormalizedRuntimeEvent)
    expect(textOf(events)).toBe('final answer')
    expect((events[0]?.payload as { final: boolean }).final).toBe(true)
  })

  it('passes anything that is not a fragment straight through', () => {
    expect(withMessageDelta([], tool(1))).toHaveLength(1)
  })

  it('agrees with the whole-record form, which is the point of them sharing a file', () => {
    const arriving = [fragment(1, 'a'), tool(2), fragment(3, 'b'), fragment(4, 'c', true)]
    let live: readonly NormalizedRuntimeEvent[] = []
    for (const event of arriving) live = withMessageDelta(live, event)
    expect(textOf(live)).toBe(textOf(joinMessageFragments(arriving)))
  })
})
