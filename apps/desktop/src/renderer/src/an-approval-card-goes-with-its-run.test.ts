import { describe, expect, it } from 'vitest'

import { approvalsOfLiveRuns } from './approvalsOfLiveRuns.js'

/**
 * M31: an approval card whose run has ended is not left behind with dead
 * buttons and a permanent "waiting on you"; one whose run is live, or not yet
 * known to the window, stays.
 */
const card = (runId: string) => ({ approvalId: `ap_${runId}`, runId })

describe('approval cards', () => {
  it('go when their run is stopped, fails or finishes', () => {
    for (const phase of ['cancelled', 'failed', 'completed']) {
      const runs = new Map([['run_1', { phase }]])
      expect(approvalsOfLiveRuns([card('run_1')], runs)).toEqual([])
    }
  })

  it('stay while their run is live, found by key or by its runId', () => {
    const runs = new Map([
      ['run_1', { phase: 'running' }],
      ['pending_2', { phase: 'waiting', data: { runId: 'run_2' } }]
    ])
    expect(approvalsOfLiveRuns([card('run_1'), card('run_2')], runs)).toHaveLength(2)
  })

  it('stay when the window does not know the run yet', () => {
    expect(approvalsOfLiveRuns([card('run_new')], new Map())).toHaveLength(1)
  })

  it('keeps the same list when nothing changes, so the state does not churn', () => {
    const list = [card('run_1')]
    expect(approvalsOfLiveRuns(list, new Map([['run_1', { phase: 'running' }]]))).toBe(list)
  })
})
