import type { ReconciledCheckpoint } from '@teammate/mission-store'
import { describe, expect, it } from 'vitest'

import { chosenLeaveOut, composeHandoffPrompt, MAX_HANDOFF_PROMPT_LENGTH } from './handoff.js'

/*
 * A PERSON CAN LEAVE OUT PART OF A BRIEF (0.527, product ideas round four:
 * "with a way to drop a section"). A reply on another runtime is briefed from
 * sections; the person may know one is stale and would mislead. The earlier
 * messages, the finished steps and the last reply may go. The task, the
 * person's own words and the steps that never reported back may not.
 */
const checkpoint = (overrides: Partial<ReconciledCheckpoint> = {}): ReconciledCheckpoint => ({
  missionId: 'mission_prior',
  epoch: 2,
  reason: 'route-switch',
  resumeSafety: 'safe',
  safetyReason: 'settled',
  createdAt: '2026-10-01T17:00:00.000Z',
  unsettledActions: [],
  settledActions: ['write src/app.ts'],
  settledNames: ['write src/app.ts'],
  assistantSummary: 'I moved the session check after the cookie is set.',
  ...overrides
}) as unknown as ReconciledCheckpoint

const EARLIER = [{ asked: 'Fix the login redirect loop', answered: 'Fixed by moving the session check.' }]

describe('a person can leave out part of a brief', () => {
  it('leaves out the last reply when asked, and the brief says the person chose it', () => {
    const briefing = composeHandoffPrompt('Fix the login redirect loop', checkpoint(), 'Codex CLI', 'Now do the signup form', EARLIER, undefined, ['summary'])
    expect(briefing).toBeDefined()
    expect(briefing?.prompt).not.toContain('I moved the session check after the cookie is set.')
    expect(briefing?.prompt).toContain('Now do the signup form')
    expect(briefing?.prompt).toMatch(/\(The person chose to leave out its last reply\.\)$/)
    expect(briefing?.kept).toEqual(['task', 'earlier', 'settled'])
    expect(briefing?.leftOutByYou).toEqual(['summary'])
    expect(briefing?.omitted).toEqual([])
  })

  it('can leave out every section it offers at once, and the task and the reply stay', () => {
    const briefing = composeHandoffPrompt('Fix the login redirect loop', checkpoint(), 'Codex CLI', 'Now do the signup form', EARLIER, undefined, ['earlier', 'settled', 'summary'])
    expect(briefing?.kept).toEqual(['task'])
    expect(briefing?.leftOutByYou).toEqual(['earlier', 'settled', 'summary'])
    expect(briefing?.prompt).toContain('Fix the login redirect loop')
    expect(briefing?.prompt).toContain('Now do the signup form')
  })

  it('never leaves out the task, the reply or the steps that never reported back, whatever is sent', () => {
    const unsettled = checkpoint({ unsettledActions: [{ toolKind: 'command', name: 'npm run migrate' }] as unknown as ReconciledCheckpoint['unsettledActions'] })
    const briefing = composeHandoffPrompt('Fix the login redirect loop', unsettled, 'Codex CLI', 'Now do the signup form', EARLIER, undefined, ['task', 'next', 'unsettled'])
    expect(briefing?.leftOutByYou).toEqual([])
    expect(briefing?.prompt).toContain('npm run migrate')
    expect(briefing?.prompt).toContain('Fix the login redirect loop')
    expect(briefing?.prompt).toContain('Now do the signup form')
    expect(briefing?.prompt).not.toContain('chose to leave out')
  })

  it('names only what was there to leave out', () => {
    const briefing = composeHandoffPrompt('Fix it', checkpoint({ assistantSummary: '' }), 'Codex CLI', 'Again', [], undefined, ['summary', 'earlier'])
    expect(briefing?.leftOutByYou).toEqual([])
  })

  it('still fits the bound when sections are left out by choice and others must go to fit', () => {
    const long = 'x'.repeat(3_000)
    const turns = Array.from({ length: 30 }, (_, index) => ({ asked: `${String(index)} ${long}`, answered: long }))
    const briefing = composeHandoffPrompt('Fix it', checkpoint({ assistantSummary: long }), 'Codex CLI', 'y'.repeat(3_900), turns, undefined, ['settled'])
    expect(briefing).toBeDefined()
    expect(briefing?.prompt.length ?? Infinity).toBeLessThanOrEqual(MAX_HANDOFF_PROMPT_LENGTH)
    expect(briefing?.leftOutByYou).toEqual(['settled'])
  })

  it('keeps what the window sent to the sections that may be left out', () => {
    expect(chosenLeaveOut(['summary', 'task', 'unsettled', 'next', 'earlier', 7, null])).toEqual(['earlier', 'summary'])
    expect(chosenLeaveOut('summary')).toEqual([])
    expect(chosenLeaveOut(undefined)).toEqual([])
  })
})
