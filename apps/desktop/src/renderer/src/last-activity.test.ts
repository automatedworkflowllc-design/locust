import { describe, expect, it } from 'vitest'

import { lastActivityAt } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/*
 * B4 of docs/PLAN-2026-09-13-INTERACTION.md. grok-build keeps
 * `last_progress_at` and documents it as their dashboard's sort key; we sorted
 * by start time, so a conversation working for an hour sat below one that
 * opened five minutes ago and had been idle since.
 */
const at = (occurredAt: string): NormalizedRuntimeEvent =>
  ({ occurredAt } as unknown) as NormalizedRuntimeEvent

describe('when a mission last did something', () => {
  const createdAt = '2026-09-14T10:00:00.000Z'

  it('is the last event, when there is one', () => {
    expect(lastActivityAt({ createdAt, events: [at('2026-09-14T10:05:00.000Z'), at('2026-09-14T11:30:00.000Z')] }))
      .toBe('2026-09-14T11:30:00.000Z')
  })

  it('falls back to when it was made, for a run that has said nothing', () => {
    expect(lastActivityAt({ createdAt, events: [] })).toBe(createdAt)
  })

  it('never goes BACKWARDS from the creation time', () => {
    // A runtime clock behind the host's would otherwise sort a live run below
    // where it was a moment ago, which reads as the list losing it.
    expect(lastActivityAt({ createdAt, events: [at('2026-09-14T09:00:00.000Z')] })).toBe(createdAt)
  })

  it('puts a long working conversation above a newer idle one', () => {
    const working = { createdAt: '2026-09-14T09:00:00.000Z', events: [at('2026-09-14T11:59:00.000Z')] }
    const idle = { createdAt: '2026-09-14T11:00:00.000Z', events: [] }
    const order = [idle, working].sort((a, b) => lastActivityAt(b).localeCompare(lastActivityAt(a)))
    expect(order[0]).toBe(working)
  })
})
