import type { ReconciledCheckpoint } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import { composeHandoffPrompt, MAX_HANDOFF_PROMPT_LENGTH } from './handoff.js'

function checkpoint(overrides: Partial<ReconciledCheckpoint> = {}): ReconciledCheckpoint {
  return {
    missionId: 'mission_prior',
    epoch: 2,
    reason: 'route-switch',
    resumeSafety: 'safe',
    safetyReason: 'settled',
    createdAt: '2026-09-05T03:00:00.000Z',
    unsettledActions: [],
    settledActions: ['read README.md'],
    assistantSummary: 'I read the README and found two files to change.',
    ...overrides
  } as unknown as ReconciledCheckpoint
}

describe('the briefing a continuation starts with', () => {
  it('carries the person’s next instruction LAST, as the latest word', () => {
    // 0.21.2 QA, P2: after a quota failure a reply on another provider used
    // to start a stranger, and the person retyped the filenames and the task.
    const briefing = composeHandoffPrompt('check the google stock price', checkpoint(), 'Codex CLI', 'now do it in euros')
    expect(briefing).toBeDefined()
    const prompt = briefing!.prompt
    expect(prompt).toContain('another agent (Codex CLI)')
    expect(prompt).toContain('check the google stock price')
    expect(prompt.endsWith('The person now asks:\n\nnow do it in euros')).toBe(true)
    expect(prompt.indexOf('I read the README')).toBeLessThan(prompt.indexOf('The person now asks'))
  })

  it('is unchanged when there is no next instruction -- the live handoff’s own case', () => {
    const rescue = composeHandoffPrompt('check the google stock price', checkpoint(), 'Codex CLI')
    expect(rescue!.prompt).not.toContain('The person now asks')
    expect(composeHandoffPrompt('check the google stock price', checkpoint(), 'Codex CLI', '   ')!.prompt)
      .toBe(rescue!.prompt)
  })

  it('never drops the next instruction to make room: it refuses instead', () => {
    // A summary large enough to fill the budget is dropped first; the next
    // instruction is not optional. If the task and the instruction alone do
    // not fit, the caller gets nothing rather than a run pointed at the
    // wrong task.
    const huge = 'x'.repeat(MAX_HANDOFF_PROMPT_LENGTH)
    const squeezed = composeHandoffPrompt('short task', checkpoint({ assistantSummary: huge }), 'Codex CLI', 'and then this')
    expect(squeezed).toBeDefined()
    expect(squeezed!.omitted).toContain('summary')
    expect(squeezed!.prompt).toContain('and then this')

    const impossible = composeHandoffPrompt('short task', checkpoint(), 'Codex CLI', huge)
    expect(impossible).toBeUndefined()
  })
})
