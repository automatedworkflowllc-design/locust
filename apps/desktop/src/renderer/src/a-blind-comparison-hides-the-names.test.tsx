import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { blindName, compareRecord } from '../../shared/compare.js'
import type { PublicCompare } from '../../shared/compare.js'
import { CompareView } from './components/CompareView.js'
import type { CompareColumnView } from './components/CompareView.js'

/**
 * BLIND COMPARE, AND YOUR OWN RECORD (0.449, after Arena's Battle and
 * leaderboard; PLAN-2026-09-28-NEXT item 5).
 *
 * Blind: the columns read Model A and Model B, and nothing on them names the
 * model -- not its mark, its runtime or its cost -- until one is kept. The
 * record: every Keep is a vote, and the picker shows each model's own.
 */
const base: PublicCompare = {
  compareId: 'cmp_1',
  prompt: 'Make index.html: a landing page.',
  createdAt: '2026-09-28T12:00:00.000Z',
  blind: true,
  slots: [
    { slot: 'a', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', label: 'Mimo V2.6 Flash Free' }, missionIds: ['m_a'] },
    { slot: 'b', route: { runtime: 'claude', model: 'sonnet', label: 'Sonnet 5.5' }, missionIds: ['m_b'] }
  ]
}
const column = (slot: 'a' | 'b', name: string, runtime: 'opencode' | 'claude', runtimeName: string): CompareColumnView => ({
  slot,
  name,
  runtime,
  runtimeName,
  turns: [{ missionId: `m_${slot}`, items: [], running: false }],
  running: false,
  keepable: true,
  retryable: false,
  answer: 'Done.',
  state: 'done',
  span: '40s',
  cost: slot === 'b' ? 'in your plan' : '9.1k in · 2.2k out'
})
const render = (compare: PublicCompare, columns: readonly CompareColumnView[]): string =>
  renderToStaticMarkup(
    <CompareView
      compare={compare}
      changeLines={{}}
      prompts={[compare.prompt]}
      columns={columns}
      owner={undefined}
      workspacePath={undefined}
      keeping={false}
      retrying={undefined}
      onKeep={() => undefined}
      onRetry={() => undefined}
      onBack={undefined}
    />
  )

describe('a blind comparison', () => {
  it('names its columns Model A and Model B, and shows nothing that names the model', () => {
    const html = render(base, [column('a', blindName('a'), 'opencode', 'OpenCode'), column('b', blindName('b'), 'claude', 'Claude Code')])
    expect(html).toContain('Comparing Model A and Model B, names hidden until you keep one.')
    for (const giveaway of ['OpenCode', 'Claude Code', 'Mimo', 'Sonnet', 'in your plan', '9.1k in']) expect(html).not.toContain(giveaway)
    // How long each took is not a name: it stays.
    expect(html).toContain('40s')
  })

  it('shows the names once one is kept', () => {
    const kept: PublicCompare = { ...base, kept: { slot: 'b', at: '2026-09-28T12:05:00.000Z' } }
    const html = render(kept, [column('a', 'Mimo V2.6 Flash Free', 'opencode', 'OpenCode'), column('b', 'Sonnet 5.5', 'claude', 'Claude Code')])
    expect(html).toContain('You kept Sonnet 5.5')
    expect(html).toContain('OpenCode')
    expect(html).toContain('in your plan')
  })
})

describe('your record', () => {
  it('counts, per model, the decided comparisons it answered in and the ones you kept it', () => {
    const decided = (id: string, keptSlot: 'a' | 'b', b: { runtime: string; model: string }): PublicCompare => ({
      compareId: id,
      prompt: 'x',
      createdAt: '2026-09-28T12:00:00.000Z',
      slots: [
        { slot: 'a', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free' }, missionIds: [`${id}_a`] },
        { slot: 'b', route: b, missionIds: [`${id}_b`] }
      ],
      kept: { slot: keptSlot, at: '2026-09-28T12:05:00.000Z' }
    })
    const sonnet = { runtime: 'claude', model: 'sonnet' }
    const record = compareRecord([
      decided('cmp_1', 'b', sonnet),
      decided('cmp_2', 'a', sonnet),
      decided('cmp_3', 'b', sonnet),
      // Undecided: counts for nothing yet.
      { ...decided('cmp_4', 'a', sonnet), kept: undefined } as unknown as PublicCompare,
      // A column that never answered counts for nothing.
      { ...decided('cmp_5', 'a', { runtime: 'cursor', model: 'grok-4.6' }), slots: [
        { slot: 'a', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free' }, missionIds: ['cmp_5_a'] },
        { slot: 'b', route: { runtime: 'cursor', model: 'grok-4.6' }, missionIds: [], refused: 'It could not start.' }
      ] }
    ])
    expect(record.get('claude:sonnet')).toEqual({ kept: 2, compared: 3 })
    expect(record.get('opencode:opencode/mimo-v2.6-flash-free')).toEqual({ kept: 2, compared: 4 })
    expect(record.has('cursor:grok-4.6')).toBe(false)
  })
})
