import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { MissionLedgerMetadata, RecoveredMission } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { usageTurnOf, usageTurns } from './mission-history.js'
import { cachedPercent, localDate, promptTokens, totalTokens, usageSummary } from '../shared/usage.js'
import type { UsageTurn } from '../shared/usage.js'

/*
 * USAGE IS COUNTED (0.714): every turn the ledger holds, added up by the host
 * for the Usage dialog and the line on Home -- Claude Code's /stats and
 * /usage across every agent. Nothing estimated: tokens and money are each
 * receipt's own, read in each runtime's own terms.
 */

const roots: string[] = []
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const processEvidence = (at: string): Record<string, unknown> => ({
  exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 2, inputDeliveryFailed: false,
  outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: at, finishedAt: at
})

function metadata(missionId: string, runtime: 'claude' | 'codex' | 'opencode', model: string, at: string, continues?: string): MissionLedgerMetadata {
  return {
    missionId, runId: `run_${missionId}`, prompt: 'Question', runtime, model, requestedRouteId: runtime, resolvedRouteId: `${runtime}-account:default`,
    cliVersion: 'test', workspaceId: 'ws_test', sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at,
    ...(continues === undefined ? {} : { continuesFrom: { missionId: continues, checkpointEpoch: 1, reason: 'follow-up' as const } })
  } as MissionLedgerMetadata
}

function completed(missionId: string, runtime: string, at: string, payload: Record<string, unknown>): NormalizedRuntimeEvent {
  return { id: `event_${missionId}_1`, runId: `run_${missionId}`, missionId, sequence: 1, occurredAt: at, sourceAdapter: runtime, type: 'run.completed', payload: { ...payload, process: processEvidence(at) } } as unknown as NormalizedRuntimeEvent
}

const turn = (fields: Partial<UsageTurn> & Pick<UsageTurn, 'at'>): UsageTurn => ({ runtime: 'claude', model: 'claude-opus-4-6', conversation: 'c1', ...fields })

describe('a turn as the host reads it', () => {
  const mission = (events: readonly NormalizedRuntimeEvent[], meta: MissionLedgerMetadata): RecoveredMission =>
    ({ metadata: meta, events, lastUpdatedAt: meta.createdAt, phase: 'completed' }) as unknown as RecoveredMission

  it('names the model the run reported, and keeps a plan’s dollars out of the money', () => {
    const at = '2026-10-09T15:00:00.000Z'
    const read = usageTurnOf(mission([completed('m1', 'claude', at, { resolvedModel: 'claude-opus-4-6', usage: { inputTokens: 40, cacheReadTokens: 90_000, cacheWriteTokens: 2_000, outputTokens: 800, usd: 1.4, billing: 'subscription' } })], metadata('m1', 'claude', 'opus', at)))
    expect(read).toMatchObject({ at, runtime: 'claude', model: 'claude-opus-4-6', inputTokens: 40, cacheReadTokens: 90_000, plan: true })
    expect(read.usd).toBeUndefined()
  })

  it('an API key’s turn is money; a turn with no receipt still counts, at its last moment', () => {
    const at = '2026-10-09T16:00:00.000Z'
    expect(usageTurnOf(mission([completed('m2', 'claude', at, { usage: { inputTokens: 900, outputTokens: 40, usd: 0.02 } })], metadata('m2', 'claude', 'haiku', at))).usd).toBe(0.02)
    const failed = usageTurnOf(mission([], metadata('m3', 'codex', 'gpt-6-luna', at, 'm2')))
    expect(failed).toMatchObject({ at, runtime: 'codex', model: 'gpt-6-luna', continues: 'm2' })
    expect(failed.inputTokens).toBeUndefined()
  })

  it('every turn the ledger holds, each named by its conversation’s first turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'locust-usage-'))
    roots.push(root)
    const ledger = createFileMissionLedger({ rootDirectory: root })
    const at = (minute: number): string => `2026-10-09T15:${String(minute).padStart(2, '0')}:00.000Z`
    await ledger.createMission(metadata('m_a', 'codex', 'gpt-6-luna', at(1)))
    await ledger.appendEvents('m_a', [completed('m_a', 'codex', at(2), { usage: { inputTokens: 1000, cacheReadTokens: 600, outputTokens: 50 } })])
    await ledger.createMission(metadata('m_b', 'codex', 'gpt-6-luna', at(3), 'm_a'))
    await ledger.appendEvents('m_b', [completed('m_b', 'codex', at(4), { usage: { inputTokens: 2000, cacheReadTokens: 1500, outputTokens: 70 } })])
    await ledger.createMission(metadata('m_c', 'codex', 'gpt-6-luna', at(5), 'm_b'))
    await ledger.createMission(metadata('m_d', 'opencode', 'opencode/space-bunny-free', at(6)))
    await ledger.appendEvents('m_d', [completed('m_d', 'opencode', at(7), { usage: { inputTokens: 300, outputTokens: 20, usd: 0 } })])
    await ledger.flush()
    const turns = await usageTurns(ledger)
    expect(turns).toHaveLength(4)
    const byId = new Map((turns ?? []).map((one) => [one.at, one]))
    expect(byId.get(at(4))?.conversation).toBe('m_a')
    expect((turns ?? []).filter((one) => one.conversation === 'm_a')).toHaveLength(3)
    expect(usageSummary(turns ?? [], 'all', new Date('2026-10-09T20:00:00.000Z')).conversations).toBe(2)
  })
})

describe('what the summary adds up', () => {
  const now = new Date(2026, 9, 9, 18, 0, 0)
  const day = (back: number, hour = 12): string => new Date(2026, 9, 9 - back, hour, 0, 0).toISOString()

  it('reads a prompt in each runtime’s terms: Codex counts its cache inside, Claude beside', () => {
    expect(promptTokens({ runtime: 'codex', inputTokens: 1000, cacheReadTokens: 800 })).toBe(1000)
    expect(promptTokens({ runtime: 'claude', inputTokens: 40, cacheReadTokens: 800, cacheWriteTokens: 160 })).toBe(1000)
  })

  it('cuts the range by the day each turn ended, on this machine’s clock', () => {
    const turns = [turn({ at: day(0) }), turn({ at: day(6) }), turn({ at: day(7) }), turn({ at: day(29) }), turn({ at: day(30) })]
    expect(usageSummary(turns, '7d', now).turns).toBe(2)
    expect(usageSummary(turns, '30d', now).turns).toBe(4)
    expect(usageSummary(turns, 'all', now).turns).toBe(5)
    const month = usageSummary(turns, '30d', now)
    expect(month.days).toHaveLength(30)
    expect(month.days.at(-1)?.date).toBe(localDate(now))
    expect(month.rangeDays).toBe(30)
  })

  it('twelve weeks of heatmap, Sunday first, ending today', () => {
    const summary = usageSummary([turn({ at: day(0) })], '7d', now)
    expect(summary.heatmap).toHaveLength(11 * 7 + now.getDay() + 1)
    expect(summary.heatmap.at(-1)).toMatchObject({ date: localDate(now), turns: 1 })
    expect(new Date(`${summary.heatmap[0]!.date}T12:00:00`).getDay()).toBe(0)
  })

  it('streaks run back from today, or from yesterday while today has nothing yet', () => {
    const turns = [turn({ at: day(1) }), turn({ at: day(2) }), turn({ at: day(3) }), turn({ at: day(10) }), turn({ at: day(11) })]
    expect(usageSummary(turns, 'all', now).streak).toEqual({ current: 3, longest: 3 })
    expect(usageSummary([...turns, turn({ at: day(0) })], 'all', now).streak.current).toBe(4)
    expect(usageSummary([turn({ at: day(5) })], 'all', now).streak.current).toBe(0)
  })

  it('a model each, most turns first, and how each was paid for', () => {
    const turns = [
      turn({ at: day(0), runtime: 'claude', model: 'claude-opus-4-6', plan: true, inputTokens: 10, cacheReadTokens: 900, outputTokens: 50 }),
      turn({ at: day(0), runtime: 'claude', model: 'claude-opus-4-6', plan: true, inputTokens: 10, cacheReadTokens: 900, outputTokens: 50 }),
      turn({ at: day(1), runtime: 'claude', model: 'claude-haiku-4-5', usd: 0.25, inputTokens: 100, cacheReadTokens: 0, outputTokens: 10 }),
      turn({ at: day(1), runtime: 'opencode', model: 'opencode/space-bunny-free', inputTokens: 500, outputTokens: 30 }),
      turn({ at: day(2), runtime: 'copilot', model: 'auto', premiumRequests: 1 })
    ]
    const summary = usageSummary(turns, '30d', now)
    // Ties on turns go to the model that read and wrote more.
    expect(summary.models.map((model) => model.model)).toEqual(['claude-opus-4-6', 'opencode/space-bunny-free', 'claude-haiku-4-5', 'auto'])
    expect(summary.models[0]).toMatchObject({ turns: 2, planTurns: 2, freeTurns: 0 })
    expect(summary.models[0]!.usd).toBeUndefined()
    expect(summary.pay).toMatchObject({ usd: 0.25, premiumRequests: 1, planTurns: 2, freeTurns: 1 })
    expect(totalTokens(summary.models[0]!.tokens)).toBe(2 * (10 + 900 + 50))
  })

  it('a cache share is over the turns whose runtime counts a cache, not a 0% for one that says nothing', () => {
    const counted = usageSummary([turn({ at: day(0), inputTokens: 100, cacheReadTokens: 900, outputTokens: 1 })], '7d', now)
    expect(cachedPercent(counted.tokens)).toBe(90)
    const silent = usageSummary([turn({ at: day(0), runtime: 'opencode', model: 'opencode/space-bunny-free', inputTokens: 5000, outputTokens: 1 })], '7d', now)
    expect(cachedPercent(silent.tokens)).toBeUndefined()
    const both = usageSummary([...[turn({ at: day(0), inputTokens: 100, cacheReadTokens: 900, outputTokens: 1 })], turn({ at: day(0), runtime: 'opencode', model: 'opencode/space-bunny-free', inputTokens: 5000, outputTokens: 1 })], '7d', now)
    expect(cachedPercent(both.tokens)).toBe(90)
  })

  it('active days, the busiest day, and nothing counted twice', () => {
    const turns = [turn({ at: day(0, 9) }), turn({ at: day(0, 15) }), turn({ at: day(3) })]
    const summary = usageSummary(turns, '7d', now)
    expect(summary.activeDays).toBe(2)
    expect(summary.busiest).toMatchObject({ date: localDate(now), turns: 2 })
    expect(summary.days.reduce((sum, one) => sum + one.turns, 0)).toBe(3)
  })
})
