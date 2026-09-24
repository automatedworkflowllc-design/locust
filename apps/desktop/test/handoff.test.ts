import { describe, expect, it } from 'vitest'
import type { ReconciledCheckpoint } from '@teammate/mission-store'

import {
  composeHandoffPrompt,
  MAX_HANDOFF_PROMPT_LENGTH,
  NOTICE_BUDGET,
  omissionNotice,
  OPTIONAL_SECTION_NAMES
} from '../src/main/handoff.js'

function checkpoint(overrides: Partial<ReconciledCheckpoint> = {}): ReconciledCheckpoint {
  return {
    schemaVersion: 1,
    missionId: 'mission_a',
    runId: 'run_a',
    epoch: 1,
    reason: 'route-switch',
    reconciledThroughSequence: 12,
    settledActions: [],
    unsettledActions: [],
    resumeSafety: 'safe',
    safetyReason: 'Nothing was in flight.',
    transcriptDigest: 'digest',
    assistantSummary: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  } as ReconciledCheckpoint
}

function unsettled(name: string) {
  return {
    itemId: `item_${name}`,
    toolKind: 'command',
    name,
    startedAt: '2026-09-01T00:00:00.000Z',
    startedAtSequence: 4
  }
}

describe('composeHandoffPrompt', () => {
  it('carries the original task and names the runtime that stopped', () => {
    const brief = composeHandoffPrompt('Refactor the parser.', checkpoint(), 'Codex')

    expect(brief?.prompt).toContain('Refactor the parser.')
    expect(brief?.prompt).toContain('Codex')
    expect(brief?.omitted).toEqual([])
  })

  it('tells the new runtime to verify actions that never reported back', () => {
    const brief = composeHandoffPrompt(
      'Refactor the parser.',
      checkpoint({
        resumeSafety: 'approval-required',
        unsettledActions: [unsettled('rm -rf build')]
      }),
      'Codex'
    )

    expect(brief?.prompt).toContain('rm -rf build')
    // The whole point of reconciling: the next runtime must not assume either
    // outcome for an action that started and never finished.
    expect(brief?.prompt).toMatch(/unknown/i)
    expect(brief?.prompt).toMatch(/before you redo or build on any of them/i)
  })

  it('separates what finished from what did not', () => {
    const brief = composeHandoffPrompt(
      'Task.',
      checkpoint({
        settledActions: ['call_1'],
        settledNames: ['read src/index.ts'],
        unsettledActions: [unsettled('write src/index.ts')]
      }),
      'Codex'
    )

    const prompt = brief?.prompt ?? ''
    // The unsettled section must come FIRST: it is the safety-critical half,
    // and it is the half that survives when the brief has to be trimmed.
    expect(prompt.indexOf('write src/index.ts')).toBeLessThan(prompt.indexOf('read src/index.ts'))
  })

  it('drops the summary before the unsettled actions when space runs out', () => {
    const brief = composeHandoffPrompt(
      'Task.',
      checkpoint({
        assistantSummary: 'x'.repeat(4_000),
        settledActions: ['call_1'],
        settledNames: [`settled ${'y'.repeat(3_800)}`],
        unsettledActions: [unsettled('the dangerous one')]
      }),
      'Codex'
    )

    expect(brief).toBeDefined()
    expect(brief?.prompt).toContain('the dangerous one')
    expect(brief?.omitted).toContain('summary')
    expect(brief?.prompt.length).toBeLessThanOrEqual(MAX_HANDOFF_PROMPT_LENGTH)
  })

  it('says so when detail was left out, rather than reading as complete', () => {
    const brief = composeHandoffPrompt(
      'Task.',
      checkpoint({ assistantSummary: 'x'.repeat(7_999) }),
      'Codex'
    )

    expect(brief?.omitted).toEqual(['summary'])
    expect(brief?.prompt).toContain('did not fit and was left out')
  })

  it('reserves enough room for the longest possible omission notice', () => {
    // Every optional section dropped at once is the worst case; if the reserve
    // were short of it the composed prompt could exceed the bound and be
    // rejected by the composer with a message about the user's typing.
    const brief = composeHandoffPrompt(
      'a'.repeat(MAX_HANDOFF_PROMPT_LENGTH - 400),
      checkpoint({
        assistantSummary: 'x'.repeat(3_000),
        settledActions: ['call_1'],
        settledNames: [`settled ${'z'.repeat(300)}`],
        unsettledActions: [unsettled('unsettled thing')]
      }),
      'Codex'
    )

    expect(brief?.omitted).toEqual(['unsettled', 'settled', 'summary'])
    expect(brief?.prompt.length).toBeLessThanOrEqual(MAX_HANDOFF_PROMPT_LENGTH)
  })

  it('reserves room for the longest notice every optional section could produce', () => {
    // This test stands in for a runtime guard that was deliberately removed.
    // Because the budget holds NOTICE_BUDGET back up front, an assembled prompt
    // can never exceed the bound -- so a check for it would have been dead code
    // that no mutation could turn red. The invariant that makes it dead is the
    // one pinned here: the worst-case notice, naming every optional section,
    // has to fit inside the reserve. Add a fifth section that outgrows it and
    // this fails now, rather than a user's handoff being refused later.
    const worstCase = omissionNotice([...OPTIONAL_SECTION_NAMES])

    // +2 for the blank line the notice is joined on.
    expect(worstCase.length + 2).toBeLessThanOrEqual(NOTICE_BUDGET)
  })

  it('refuses rather than truncating a request too long to carry', () => {
    expect(composeHandoffPrompt('a'.repeat(MAX_HANDOFF_PROMPT_LENGTH), checkpoint(), 'Codex')).toBeUndefined()
  })
})
