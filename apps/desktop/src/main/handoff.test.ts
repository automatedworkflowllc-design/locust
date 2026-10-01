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

  // QA-2026-09-29 round 2, R18: 3,900 + 3,900 was refused, when the person
  // was switching runtimes because of a limit.
  it('clips a long original task to carry the new words whole, and says how much it cut', () => {
    const task = `Spec start. ${'a'.repeat(3_900)} Spec end.`
    const reply = `Now do this. ${'b'.repeat(3_900)} The end.`
    const carried = composeHandoffPrompt(task, checkpoint(), 'Codex CLI', reply)
    expect(carried).toBeDefined()
    expect(carried!.prompt.length).toBeLessThanOrEqual(MAX_HANDOFF_PROMPT_LENGTH)
    expect(carried!.prompt).toContain(reply)
    expect(carried!.prompt).toContain('Spec start.')
    expect(carried!.prompt).not.toContain('Spec end.')
    expect(carried!.prompt).toMatch(/\[The original task continues for \d+ more characters that did not fit here\. Ask the person if the part above is not enough\.\]/)
    // And it says so, for the preview under the box (0.517).
    expect(carried!.taskClipped).toBe(true)
  })

  // 0.517: the preview under the box reads these, so they must be the sections actually in the prompt.
  it('names the sections it carried, in reading order, and only those', () => {
    const whole = composeHandoffPrompt('Add a chart', checkpoint(), 'Claude Code', 'Now make it blue', [{ asked: 'Start', answered: 'Started' }])
    expect(whole?.kept).toEqual(['task', 'earlier', 'settled', 'summary'])
    expect(whole?.omitted).toEqual([])
    expect(whole?.taskClipped).toBeUndefined()
    const squeezed = composeHandoffPrompt('Add a chart', checkpoint({ assistantSummary: 's'.repeat(7_000) }), 'Claude Code', `Now ${'b'.repeat(1_500)}`)
    expect(squeezed?.omitted).toContain('summary')
    expect(squeezed?.kept).not.toContain('summary')
    expect(squeezed?.prompt).not.toContain('What the previous agent said it had done')
  })
})

// QA-2026-09-29 round 2, N4: a clean switch is not a rescue.
describe('what the brief says happened', () => {
  it('after a clean finish and a reply, says the conversation was taken over, not stopped partway', () => {
    const clean = composeHandoffPrompt('Add a chart', checkpoint(), 'Claude Code', 'Now make it blue')
    expect(clean?.prompt).toContain('taking over this conversation from another agent (Claude Code), which finished its last turn. The last thing it was asked was:')
    expect(clean?.prompt).not.toContain('stopped partway')
  })

  it('after a stop with work in flight, still says it stopped partway', () => {
    const stopped = composeHandoffPrompt('Add a chart', checkpoint({ unsettledActions: [{ toolKind: 'shell', name: 'npm test' }] as never }), 'Claude Code', 'Carry on')
    expect(stopped?.prompt).toContain('started and stopped partway through')
  })
})
