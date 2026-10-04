import { describe, expect, it } from 'vitest'

import type { PublicCompare } from '../../shared/compare.js'
import { compareRecordRows } from './compareRecord.js'

/**
 * YOUR COMPARE RECORD, AS A TABLE (0.519), after Artificial Analysis's
 * Optima: each model, how often you kept it, its typical time and cost.
 */
const column = (slot: 'a' | 'b', model: string, missionIds: readonly string[] = [`m_${slot}_${model}`]) =>
  ({ slot, route: { runtime: 'opencode', model, label: model.toUpperCase() }, missionIds })
const compare = (id: string, a: string, b: string, kept?: 'a' | 'b', missionB?: readonly string[]): PublicCompare =>
  ({ compareId: id, prompt: id, createdAt: '2026-10-01T00:00:00Z', slots: [column('a', a), column('b', b, missionB)], ...(kept === undefined ? {} : { kept: { slot: kept, at: '2026-10-01T00:01:00Z' } }) }) as PublicCompare

describe('your compare record', () => {
  const compares = [compare('c1', 'mimo', 'ling', 'a'), compare('c2', 'mimo', 'muse', 'a'), compare('c3', 'ling', 'mimo', 'a'), compare('undecided', 'muse', 'ling')]
  const seconds: Record<string, number> = { c1a: 20, c1b: 40, c2a: 30, c2b: 60, c3a: 50, c3b: 40 }
  const rows = compareRecordRows(
    compares,
    (one, slot) => ({ ms: (seconds[`${one.compareId}${slot}`] ?? 0) * 1000, cost: { inputTokens: 2000, outputTokens: (seconds[`${one.compareId}${slot}`] ?? 0) * 10 } }),
    (route) => route.label ?? route.model
  )

  it('counts only decided comparisons, the most kept first', () => {
    expect(rows.map((row) => [row.name, row.kept, row.compared])).toEqual([['MIMO', 2, 3], ['LING', 1, 2], ['MUSE', 0, 1]])
  })

  it('gives each model the middle of its answers\' times and costs', () => {
    expect(rows[0]).toEqual(expect.objectContaining({ time: '30s', cost: '2.0k in · 300 out' }))
    expect(rows[2]).toEqual(expect.objectContaining({ time: '1m 00s' }))
  })

  it('a column that never answered counts for nothing, and a model with no reported cost has none', () => {
    const silent = compareRecordRows([compare('c', 'mimo', 'ling', 'a', [])], () => ({}), (route) => route.model)
    expect(silent).toEqual([{ key: 'opencode:mimo', name: 'mimo', kept: 1, compared: 1 }])
  })
})
