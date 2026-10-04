import { describe, expect, it } from 'vitest'

import { activityTrace, runSpanMs, traceOutcome } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * ONE CLOCK FOR A RUN.
 *
 * Yurt's beta report (2026-09-23, #14): a turn's fold said 37s and the
 * Missions row said 43s for the same mission -- the row timed from the
 * mission's creation to its last ledger write, launch and receipt included.
 * Both read the run's own first and last events now.
 */
const at = (seconds: number, type: string): NormalizedRuntimeEvent =>
  ({ id: `e${String(seconds)}`, runId: 'r', sequence: seconds, occurredAt: new Date(Date.UTC(2026, 8, 23, 12, 0, seconds)).toISOString(), sourceAdapter: 'claude', type, payload: {} }) as unknown as NormalizedRuntimeEvent

describe("a run's duration", () => {
  it('is its first event to its last', () => {
    expect(runSpanMs([at(3, 'run.started'), at(20, 'tool.started'), at(40, 'run.completed')])).toBe(37_000)
  })

  it('is unknown with fewer than two events', () => {
    expect(runSpanMs([at(3, 'run.started')])).toBeUndefined()
    expect(runSpanMs([])).toBeUndefined()
  })

  it('is what the fold line says', () => {
    const events = [at(3, 'run.started'), at(40, 'run.completed')]
    expect(activityTrace([], events, traceOutcome(events, false))[0]?.text).toBe('37s')
  })
})
