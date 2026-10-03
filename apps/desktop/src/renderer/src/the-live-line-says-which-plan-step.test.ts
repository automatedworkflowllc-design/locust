import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { buildThread } from './missionView.js'

/**
 * THE LIVE LINE SAYS WHICH STEP OF THE PLAN (0.493). Colin, 2026-09-30, on a
 * 58-minute Codex run: the plan "didn't initiate the plan and just showed it
 * as completed after". Codex had sent its plan before its first command; the
 * card sat at the top of the turn, scrolled out of view, and nothing where
 * the eye is said where the run was in it.
 */
let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`, runId: 'r', missionId: 'm', sequence, occurredAt: '2026-09-30T09:00:00.000Z',
    sourceAdapter: 'codex', type, payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}
const plan = (states: readonly string[]): NormalizedRuntimeEvent =>
  event('plan.updated', { plan: { plan: states.map((status, index) => ({ step: `Step ${String(index + 1)}`, status })) } })

describe('the live line of a turn with a plan', () => {
  it('names the step underway, where the eye is', () => {
    const items = buildThread([event('run.started', {}), plan(['completed', 'in_progress', 'pending']), event('tool.started', { itemId: 't', toolKind: 'command_execution', name: 'shell', command: 'npm test', phase: 'started' })], { running: true })
    const live = items.find((item) => item.type === 'live-step')
    expect(live?.type === 'live-step' ? live.detail : undefined).toBe('step 2 of 3')
  })

  it('leads with what the open call is doing, in words (0.569, Claude Code\'s status line)', () => {
    const live = (open: Record<string, unknown>) => {
      const items = buildThread([event('run.started', {}), plan(['completed', 'in_progress', 'pending']), event('tool.started', { itemId: 't', phase: 'started', ...open })], { running: true })
      const found = items.find((item) => item.type === 'live-step')
      return found?.type === 'live-step' ? found.action : undefined
    }
    expect(live({ toolKind: 'command_execution', name: 'shell', command: 'npm test' })).toBe('Running npm test')
    expect(live({ toolKind: 'command_execution', name: 'shell', command: 'cat notes.txt' })).toBe('Reading notes.txt')
    expect(live({ toolKind: 'command_execution', name: 'shell', command: 'rg kiln src' })).toBe('Searching for kiln')
    // The model's own description, where it gave one, as Claude Code shows it.
    expect(live({ toolKind: 'tool_use', name: 'Bash', command: 'npm test', title: 'Run the test suite' })).toBe('Run the test suite')
    expect(live({ toolKind: 'write_to_file', name: 'write_to_file', command: 'C:\\work\\summary.txt' })).toBe('Editing summary.txt')
  })

  it('names the plan\'s step under way when no call is open to say more (OpenCode reports calls once they end)', () => {
    const items = buildThread([event('run.started', {}), plan(['completed', 'in_progress', 'pending'])], { running: true })
    const live = items.find((item) => item.type === 'live-step')
    expect(live?.type === 'live-step' ? [live.action, live.detail] : []).toEqual(['Step 2', 'step 2 of 3'])
  })

  it('says nothing of a plan with no step underway', () => {
    const items = buildThread([event('run.started', {}), plan(['pending', 'pending'])], { running: true })
    const live = items.find((item) => item.type === 'live-step')
    expect(live?.type === 'live-step' ? live.detail : 'none').toBeUndefined()
  })
})
