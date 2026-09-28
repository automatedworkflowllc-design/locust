import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PublicCompare } from '../../shared/compare.js'
import { CompareView } from './components/CompareView.js'
import type { CompareColumnView } from './components/CompareView.js'

/**
 * A COLUMN WHOSE ANSWER FAILED HAS NOTHING TO KEEP (0.441).
 *
 * The first packaged compare drive: one free model's provider was down, its
 * column said "failed" -- and still offered Keep this one, which would have
 * carried the conversation on from an error.
 */
const compare: PublicCompare = {
  compareId: 'cmp_1',
  teammateId: 'tm_wren',
  prompt: 'What does a git worktree let you do?',
  createdAt: '2026-09-28T12:00:00.000Z',
  slots: [
    { slot: 'a', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free' }, missionIds: ['m_a'] },
    { slot: 'b', route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash Fin Free' }, missionIds: ['m_b'] }
  ]
}
const column = (slot: 'a' | 'b', keepable: boolean, state: string): CompareColumnView => ({
  slot,
  name: slot === 'a' ? 'Nemotron 3 Ultra Free' : 'Ling 3.0 Flash Fin Free',
  runtime: 'opencode',
  runtimeName: 'OpenCode',
  turns: [{ missionId: `m_${slot}`, items: [], running: false }],
  running: false,
  keepable,
  state
})

describe('keeping a column', () => {
  it('is offered on a finished answer and refused on a failed one, saying why', () => {
    const html = renderToStaticMarkup(
      <CompareView
        compare={compare}
        prompts={[compare.prompt]}
        columns={[column('a', true, 'done'), column('b', false, 'failed')]}
        owner={undefined}
        workspacePath={undefined}
        keeping={false}
        onKeep={() => undefined}
        onBack={undefined}
      />
    )
    const buttons = html.match(/<button[^>]*>Keep this one<\/button>/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).not.toContain('disabled')
    expect(buttons[1]).toContain('disabled')
    expect(buttons[1]).toContain('Nothing to keep: its answer did not finish.')
    expect(html).toContain('Comparing Nemotron 3 Ultra Free and Ling 3.0 Flash Fin Free.')
  })
})
