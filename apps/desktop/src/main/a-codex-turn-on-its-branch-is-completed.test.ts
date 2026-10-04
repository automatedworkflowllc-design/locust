import { describe, expect, it } from 'vitest'

import { turnOutcomeOf } from './turn-checkpoint.js'

/**
 * A CODEX TURN ON ITS OWN BRANCH IS COMMITTED AS COMPLETED (0.531). The
 * outcome was read from the last batch of events only; a Codex turn reports
 * its completion while it streams, so that batch had none and every Codex
 * turn on Own branch went into git as "failed" (Sol's Workflow 3, driven on
 * packaged 0.530 with drive-review-changes LOCUST_RUNTIME=codex).
 */
describe('how a turn ended, for its commit', () => {
  it('finds a completion written before the process ended', () => {
    expect(turnOutcomeOf([{ type: 'run.started' }, { type: 'message.delta' }, { type: 'run.completed' }, { type: 'usage' }])).toBe('completed')
  })

  it('says stopped for a run the person stopped, and failed for one that failed', () => {
    expect(turnOutcomeOf([{ type: 'run.started' }, { type: 'run.cancelled' }])).toBe('stopped')
    expect(turnOutcomeOf([{ type: 'run.started' }, { type: 'run.failed' }])).toBe('failed')
  })

  it('takes the newest ending, and says failed when there is none', () => {
    expect(turnOutcomeOf([{ type: 'run.failed' }, { type: 'run.completed' }])).toBe('completed')
    expect(turnOutcomeOf([{ type: 'run.started' }])).toBe('failed')
  })
})
