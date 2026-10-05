import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicCompare } from '../../shared/compare.js'
import { CompareView, stickAt } from './components/CompareView.js'
import type { CompareColumnView } from './components/CompareView.js'

/**
 * A COMPARE COLUMN READS WHOLE (2026-10-05).
 *
 * Colin, of a three-column Blind compare (docs/colin-compare-overflow-2026-10-05.png):
 * "issues with text clipping through ... the whole layout might need
 * polishing". In its frames a foot read "+1273 -0 in 1 file · 5...", a head
 * "Mimo V2.6 F...", and Model A's column stood empty beside Model B's long
 * answer, because the columns share one scroll. The half markup can show is
 * here; the stylesheet's half is src/main/the-compare-view-keeps-its-text-whole.test.ts.
 */
const compare: PublicCompare = {
  compareId: 'cmp_whole',
  prompt: 'Make a small browser RPG.',
  createdAt: '2026-10-05T00:00:00.000Z',
  changes: true,
  slots: [
    { slot: 'a', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', label: 'Mimo V2.6 Flash' }, missionIds: ['m_a'] },
    { slot: 'b', route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash' }, missionIds: ['m_b'] }
  ]
}
const column = (slot: 'a' | 'b', name: string): CompareColumnView => ({
  slot,
  name,
  runtime: 'opencode',
  runtimeName: 'OpenCode',
  turns: [{ missionId: `m_${slot}`, items: [], running: false }],
  running: false,
  keepable: true,
  retryable: false,
  answer: 'Done.',
  state: 'done',
  span: '1h 18m',
  cost: '$2.18'
})
const draw = (shown: PublicCompare, names: readonly [string, string]): string =>
  renderToStaticMarkup(
    <CompareView
      compare={shown}
      changeLines={{ a: '+1273 -0 in 1 file' }}
      prompts={[shown.prompt]}
      columns={[column('a', names[0]), column('b', names[1])]}
      owner={undefined}
      workspacePath={undefined}
      keeping={false}
      retrying={undefined}
      onKeep={() => undefined}
      onRetry={() => undefined}
      onBack={undefined}
    />
  )

describe('a compare column', () => {
  it("keeps each of its foot's numbers whole, as parts the foot can wrap between", () => {
    const html = draw(compare, ['Mimo V2.6 Flash', 'Ling 3.0 Flash'])
    const foot = html.match(/<span class="lc-compare__numbers lc-mono">(.*?)<\/span><button/)?.[1]
    expect(foot).toBe('<span class="lc-compare__part">+1273 -0 in 1 file</span><span class="lc-compare__part">1h 18m</span><span class="lc-compare__part">$2.18</span>')
  })

  it('holds everything it says in one body, the part that stays in view', () => {
    const html = draw(compare, ['Mimo V2.6 Flash', 'Ling 3.0 Flash'])
    const cells = html.match(/<div class="lc-compare__cell" aria-label="[^"]*">(<div[^>]*>)/g) ?? []
    expect(cells).toHaveLength(2)
    for (const cell of cells) expect(cell).toMatch(/<div class="lc-compare__cellbody">$/)
  })

  it("says its runtime in the name's hover, for the head too narrow to show it", () => {
    expect(draw(compare, ['Mimo V2.6 Flash', 'Ling 3.0 Flash'])).toContain('<span class="lc-compare__name" title="Mimo V2.6 Flash · OpenCode">')
  })

  it('names no runtime in a blind head, hover or not', () => {
    const html = draw({ ...compare, blind: true }, ['Model A', 'Model B'])
    expect(html).toContain('<span class="lc-compare__name" title="Model A">')
    expect(html).not.toContain('OpenCode')
  })
})

describe('where a column stays in view', () => {
  const HEAD = 46
  const PORT = 513

  it('waits under the heads when it fits', () => {
    expect(stickAt(HEAD, PORT, 200)).toBe(HEAD + 8)
  })

  it('stops with its end at the bottom edge when it is longer than the view', () => {
    const top = stickAt(HEAD, PORT, 1400)
    expect(top).toBeLessThan(0)
    // Held at that offset, its bottom sits just above the view's bottom edge.
    expect(top + 1400).toBe(PORT - 8)
  })

  it('never sits lower than under the heads, however short', () => {
    expect(stickAt(HEAD, PORT, 0)).toBe(HEAD + 8)
  })
})
