import { describe, expect, it } from 'vitest'

import type { PublicCompare } from '../../shared/compare.js'
import { comparisonOf, foldComparisons } from './compareRows.js'

/**
 * A COMPARISON IS ONE ROW IN THE SIDEBAR (0.441, compareRows.ts).
 *
 * Each column is its own mission, so without the fold a comparison of two
 * models is two conversations with one title.
 */
const compare = (kept?: 'a' | 'b'): PublicCompare => ({
  compareId: 'cmp_1',
  teammateId: 'tm_wren',
  prompt: 'Add a discount code field.',
  createdAt: '2026-09-28T12:00:00.000Z',
  slots: [
    { slot: 'a', route: { runtime: 'claude', model: 'fable', label: 'Fable 5.1' }, missionIds: ['m_a1'] },
    { slot: 'b', route: { runtime: 'codex', model: 'gpt-6-astra', label: 'GPT-6 Astra' }, missionIds: ['m_b1'] }
  ],
  ...(kept === undefined ? {} : { kept: { slot: kept, at: '2026-09-28T12:05:00.000Z' } })
})
const rows = [
  { missionId: 'm_a1', title: 'Add a discount code field.' },
  { missionId: 'm_b1', title: 'Add a discount code field.' },
  { missionId: 'm_other', title: 'Fix the cart total' }
]

describe('the sidebar', () => {
  it('lists an undecided comparison once, as the row that opens it', () => {
    const folded = foldComparisons(rows, [compare()])
    expect(folded.map((row) => row.missionId)).toEqual(['m_a1', 'm_other'])
    expect(folded[0]?.compareId).toBe('cmp_1')
    expect(folded[1]?.compareId).toBeUndefined()
  })

  it('lists a kept one as the kept column, an ordinary conversation, with its later turns', () => {
    const folded = foldComparisons([{ missionId: 'm_b2', memberIds: ['m_b1', 'm_b2'], title: 'Add a discount code field.' }, rows[0]!, rows[2]!], [compare('b')])
    expect(folded.map((row) => row.missionId)).toEqual(['m_b2', 'm_other'])
    expect(folded[0]?.compareId).toBeUndefined()
    expect(comparisonOf(['m_b1', 'm_b2'], [compare('b')])?.compareId).toBe('cmp_1')
    expect(comparisonOf(['m_other'], [compare('b')])).toBeUndefined()
  })
})
