import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { readMissionHistory } from './mission-history.js'
import type { MissionLedger, RecoveredMission } from '@teammate/mission-store'

/**
 * AN AGENT'S USAGE IS NOT FORGOTTEN BECAUSE OTHER AGENTS WERE BUSY (0.571).
 *
 * Colin, 2026-10-03: "claude code on home stopped showing usage". Measured in
 * his ledger: his newest Claude conversation was the fortieth most recent,
 * behind an evening of Codex and Antigravity runs, and the reading was read
 * off the newest twenty only.
 */
const mission = (missionId: string, runtime: string, at: string, usage?: string): RecoveredMission => ({
  metadata: {
    missionId, runId: `run_${missionId}`, prompt: 'p', runtime, model: 'account-default', requestedRouteId: runtime,
    resolvedRouteId: `${runtime}-account:default`, cliVersion: '1', workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at
  },
  events: usage === undefined
    ? [{ type: 'noise' }]
    : [{ id: `e_${missionId}`, type: 'adapter.diagnostic', sourceAdapter: runtime, occurredAt: at, payload: { level: 'info', code: `${runtime}.usage_window`, message: usage } }],
  hostFailures: [], checkpoints: [], peerLinks: [], editChecks: [], phase: 'completed', lastUpdatedAt: at, ledgerSequence: 1, issues: []
}) as unknown as RecoveredMission

const ledgerOf = (missions: readonly RecoveredMission[]): MissionLedger =>
  ({
    getMission: async (missionId: string) => missions.find((m) => m.metadata.missionId === missionId),
    listMissions: async (options?: { limit?: number }) => ({ missions: missions.slice(0, options?.limit ?? 20), issues: [], unreadableCount: 0 }),
    flush: async () => undefined
  }) as unknown as MissionLedger

// Thirty-nine newer Codex turns, then the Claude run that last said its window.
const codex = Array.from({ length: 39 }, (_, index) => mission(`mission_codex_${String(index)}`, 'codex', '2026-10-03T21:00:00.000Z'))
const claude = mission('mission_claude', 'claude', '2026-10-03T17:08:00.000Z', '5-hour window 41% used · resets 2026-10-03T22:00:00.000Z')

describe('a usage reading past the newest twenty conversations', () => {
  it('is still shown, and kept', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'locust-usage-')), 'usage-readings.json')
    const history = await readMissionHistory(ledgerOf([...codex, claude]), undefined, 'C:/work', undefined, file)
    expect(history.ok && history.data.usageWindows?.claude).toMatch(/^5-hour window 41% used/)
    expect(JSON.parse(await readFile(file, 'utf8')).claude).toMatch(/41% used/)
    // Gone even from the backfill's reach, the kept reading still answers.
    const later = await readMissionHistory(ledgerOf(codex), undefined, 'C:/work', undefined, file)
    expect(later.ok && later.data.usageWindows?.claude).toMatch(/41% used/)
  })

  it('gives way to a newer reading', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'locust-usage-')), 'usage-readings.json')
    await readMissionHistory(ledgerOf([...codex, claude]), undefined, 'C:/work', undefined, file)
    const fresh = mission('mission_claude_2', 'claude', '2026-10-03T21:30:00.000Z', '5-hour window 63% used · resets 2026-10-03T22:00:00.000Z')
    const history = await readMissionHistory(ledgerOf([fresh, ...codex]), undefined, 'C:/work', undefined, file)
    expect(history.ok && history.data.usageWindows?.claude).toMatch(/63% used/)
  })
})
