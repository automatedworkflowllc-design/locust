import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MissionHistoryResponse } from '../shared/ipc.js'
import { withLiveMissionIds } from './mission-history.js'

describe('history and host ownership are separate evidence', () => {
  it('includes every transport and sends unique live ids without changing ledger phases', () => {
    const response: MissionHistoryResponse = { ok: true, data: { missions: [], currentWorkspaceId: 'workspace', issueCount: 0, unreadableCount: 0, limitedRuntimes: {}, usageWindows: {} } }
    const answer = withLiveMissionIds(response, ['a', 'b', 'a'])
    expect(answer.ok && answer.data.liveMissionIds).toEqual(['a', 'b'])
    expect(answer.ok && answer.data.missions).toBe(response.data.missions)
    expect(response.data.liveMissionIds).toBeUndefined()
    const host = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    expect(host).toContain('return withLiveMissionIds(history, [...codexMissions.liveMissionIds(), ...antigravityMissions.liveMissionIds()])')
  })
  it('preserves a failed history read rather than inventing empty history', () => {
    const response: MissionHistoryResponse = { ok: false, error: { code: 'HISTORY_UNAVAILABLE', message: 'Local mission history could not be read.' } }
    expect(withLiveMissionIds(response, ['a'])).toBe(response)
  })
})
