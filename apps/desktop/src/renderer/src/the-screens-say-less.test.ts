import { describe, expect, it } from 'vitest'

import type { PublicRecoveredMission } from '../../shared/ipc.js'
import { costGlanceCell } from './cost.js'
import { routeChrome } from './routeName.js'
import { teammateWork } from './teammateWork.js'

/*
 * THE SCREENS SAY LESS (0.723). Colin, 2026-10-10: "make sure we dont have too much bloat or nonsense packed in
 * compared to other competitors". The look at every screen of the packaged 0.722 found the same words on every
 * card and row; he picked which go. Each change below is one of those, and each keeps what a person still needs.
 */
describe('a route on the account’s own default', () => {
  it('is the runtime’s name alone, wherever routes are spelled', () => {
    expect(routeChrome('codex', 'account-default', 'Account Default')).toBe('Codex')
    expect(routeChrome('claude', 'account-default', 'default')).toBe('Claude')
  })

  it('keeps what follows the model’s name, and every other model as it was', () => {
    expect(routeChrome('codex', 'account-default', 'Account Default · Medium', ' · ')).toBe('Codex · Medium')
    expect(routeChrome('codex', 'gpt-6-luna', 'GPT-6 Luna')).toBe('Codex / GPT-6 Luna')
  })
})

describe('the conversation list’s cost cell', () => {
  it('says what a person pays, or that a model is free, and nothing for counted tokens', () => {
    expect(costGlanceCell({ usd: 0.42 }, 'gpt-6-luna')).toBe('$0.42')
    expect(costGlanceCell({ premiumRequests: 1 }, 'auto')).toBe('1 premium request')
    expect(costGlanceCell(undefined, 'opencode/nemotron-3-ultra-free')).toBe('free')
    expect(costGlanceCell({ inputTokens: 9000, outputTokens: 870 }, 'account-default')).toBe('')
    expect(costGlanceCell({ plan: true, inputTokens: 9000, outputTokens: 870 }, 'account-default')).toBe('')
    expect(costGlanceCell(undefined, 'account-default')).toBe('')
  })
})

const turn = (missionId: string, at: string, prompt: string, continuesFrom?: string): PublicRecoveredMission =>
  ({
    missionId,
    runId: `run_${missionId}`,
    prompt,
    runtime: 'codex',
    model: 'gpt',
    createdAt: at,
    lastUpdatedAt: at,
    phase: 'completed',
    events: [],
    integrityIssueCount: 0,
    checkpoints: [],
    ...(continuesFrom === undefined ? {} : { continuesFrom: { missionId: continuesFrom, reason: 'follow-up' } })
  }) as unknown as PublicRecoveredMission

describe('a teammate card’s Recent', () => {
  it('lists conversations, each named by its first words, not each turn of one', () => {
    const missions = [
      turn('a1', '2026-10-10T10:00:00.000Z', 'Fix the login redirect loop'),
      turn('a2', '2026-10-10T10:02:00.000Z', 'Also check the signup form', 'a1'),
      turn('a3', '2026-10-10T10:04:00.000Z', 'Good, ship it', 'a2'),
      turn('b1', '2026-10-10T09:00:00.000Z', 'Rename the billing module')
    ]
    const owners = { a1: 'tm_wren', a2: 'tm_wren', a3: 'tm_wren', b1: 'tm_wren' }
    const work = teammateWork('tm_wren', missions, owners)
    // The newest turn opens the conversation and gives its time; the first names it.
    expect(work.recent.map((row) => [row.missionId, row.title])).toEqual([
      ['a3', 'Fix the login redirect loop'],
      ['b1', 'Rename the billing module']
    ])
    // Runs still counts every turn.
    expect(work.missionCount).toBe(4)
  })
})
