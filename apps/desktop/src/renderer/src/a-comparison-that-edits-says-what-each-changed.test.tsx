import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { changesLine } from '../../shared/compare.js'
import type { PublicCompare } from '../../shared/compare.js'
import { CompareView } from './components/CompareView.js'
import type { CompareColumnView } from './components/CompareView.js'

/**
 * A COMPARISON THAT EDITS SAYS WHAT EACH CHANGED (0.445, compare changes).
 *
 * Each model changes its own copy of the project; the person keeps one and
 * only its changes come into the folder. So the bar says that before any
 * press, each foot says how much its model changed, and Keep says where the
 * changes go -- never "branch", "worktree" or "commit" (the plan's words
 * rule: copy, keep, compare).
 */
const compare: PublicCompare = {
  compareId: 'cmp_1',
  prompt: 'Make the cart total add the prices up.',
  createdAt: '2026-09-28T12:00:00.000Z',
  changes: true,
  slots: [
    { slot: 'a', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free' }, missionIds: ['m_a'] },
    { slot: 'b', route: { runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', label: 'Mimo V2.6 Flash Free' }, missionIds: ['m_b'] }
  ]
}
const column = (slot: 'a' | 'b'): CompareColumnView => ({
  slot,
  name: slot === 'a' ? 'Nemotron 3 Ultra Free' : 'Mimo V2.6 Flash Free',
  runtime: 'opencode',
  runtimeName: 'OpenCode',
  turns: [{ missionId: `m_${slot}`, items: [], running: false }],
  running: false,
  keepable: true,
  retryable: false,
  answer: 'Done.',
  state: 'done',
  span: '12s'
})
const render = (changeLines: Partial<Record<'a' | 'b', string>>, shown: PublicCompare = compare): string =>
  renderToStaticMarkup(
    <CompareView
      compare={shown}
      changeLines={changeLines}
      prompts={[compare.prompt]}
      columns={[column('a'), column('b')]}
      owner={undefined}
      workspacePath={undefined}
      keeping={false}
      retrying={undefined}
      onKeep={() => undefined}
      onRetry={() => undefined}
      onBack={undefined}
    />
  )

describe('a comparison that edits', () => {
  it('says each model changes its own copy, and only the kept one comes into the folder', () => {
    const html = render({})
    expect(html).toContain('Each changes its own copy of your project; only the one you keep comes into your folder.')
    expect(html).not.toContain('They answer without changing files.')
    const keep = html.match(/<button[^>]*>Keep this one<\/button>/g) ?? []
    expect(keep).toHaveLength(2)
    expect(keep[0]).toContain('Its changes come into your folder, not committed')
    expect(html).not.toMatch(/worktree|branch/i)
  })

  /*
   * 0.555. Sol, on Auto and told to "go find the app", wrote into Colin's
   * folder from its copy: Auto runs with the whole disk, so the bar says so.
   */
  it('on Auto, says a model can still change files outside its copy', () => {
    const auto: PublicCompare = { ...compare, slots: compare.slots.map((one) => ({ ...one, route: { ...one.route, mode: 'auto' as const } })) }
    expect(render({}, auto)).toContain('On Auto, a model can still change files outside its copy if it is asked to.')
    expect(render({})).not.toContain('On Auto')
  })

  it('in a folder too big to copy, says they all work in the folder itself, and Keep brings nothing in', () => {
    const html = render({}, { ...compare, changesIn: 'folder' })
    expect(html).toContain('This folder is too big to give each its own copy, so they all work in your folder itself.')
    expect(html).not.toContain('Each changes its own copy')
    expect(html).toContain('its changes are there already')
  })

  it('puts what each changed at its foot, before its time', () => {
    const html = render({ a: changesLine({ files: 2, added: 12, removed: 3 }), b: changesLine({ files: 0, added: 0, removed: 0 }) })
    // Each its own part since 2026-10-05, so a narrow foot wraps between them (the dot is drawn by shell.css).
    expect(html).toContain('<span class="lc-compare__part">+12 −3 in 2 files</span><span class="lc-compare__part">12s</span>')
    expect(html).toContain('<span class="lc-compare__part">no changes</span><span class="lc-compare__part">12s</span>')
  })

  it('counts one file as a file', () => {
    expect(changesLine({ files: 1, added: 1, removed: 0 })).toBe('+1 −0 in 1 file')
  })
})
