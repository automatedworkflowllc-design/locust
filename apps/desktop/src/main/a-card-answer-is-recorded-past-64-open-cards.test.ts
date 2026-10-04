import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../shared/ipc.js'
import { MAX_RAISED_APPROVALS, createRaisedApprovals } from './raised-approvals.js'

/*
 * 0.599 (review 10/04, S4). The host kept the last 64 cards it RAISED, answered
 * or not, to write each answer into the record. Past 64 open cards the oldest
 * unanswered one was evicted, so its answer went unrecorded and "don't ask
 * again" on it said the card was no longer waiting. An answered card now
 * leaves the list when its answer is recorded; the cap counts cards still
 * waiting.
 */
const request = (n: number): MissionApprovalRequest => ({
  approvalId: `ap_${String(n)}`,
  runId: 'run_1',
  missionId: 'mission_1',
  kind: 'command',
  summary: 'Run a command',
  detail: `echo ${String(n)}`,
  cwd: null,
  requestedAt: '2026-10-04T00:00:00.000Z'
})

describe('the cards the host keeps until their answers are recorded', () => {
  it('still has the first card when its answer comes after 80 more were raised and answered', () => {
    const raised = createRaisedApprovals()
    raised.remember(request(0))
    for (let n = 1; n <= 80; n += 1) {
      raised.remember(request(n))
      raised.forget(`ap_${String(n)}`)
    }
    expect(raised.get('ap_0')).toBeDefined()
    expect(raised.size).toBe(1)
  })

  it('keeps at most 64 cards still waiting, the newest; the oldest waiting one goes', () => {
    const raised = createRaisedApprovals()
    for (let n = 0; n <= MAX_RAISED_APPROVALS; n += 1) raised.remember(request(n))
    expect(raised.size).toBe(MAX_RAISED_APPROVALS)
    expect(raised.get('ap_0')).toBeUndefined()
    expect(raised.get(`ap_${String(MAX_RAISED_APPROVALS)}`)).toBeDefined()
  })

  it('forgets an answered card, keeps who it was raised for until then, and an unknown id is nothing', () => {
    const raised = createRaisedApprovals()
    raised.remember(request(1), 'tm_wren')
    expect(raised.get('ap_1')?.teammateId).toBe('tm_wren')
    raised.forget('ap_1')
    raised.forget('ap_1')
    raised.forget('ap_nope')
    expect(raised.get('ap_1')).toBeUndefined()
    expect(raised.size).toBe(0)
  })

  it('the answer funnel forgets the card right after recording it (source guard)', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8').split('\n')
    const at = source.findIndex((line) => line.includes('const answerApproval = async'))
    expect(at).toBeGreaterThan(-1)
    const body = source.slice(at, at + 10).join('\n')
    expect(body).toContain('recordAnswer(answer, by, words)')
    expect(body).toContain('raisedApprovals.forget(answer.approvalId)')
  })
})
