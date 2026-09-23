import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CLAUDE_OLDER_MODELS } from '../../shared/claude-models.js'
import type { PublicModel, PublicRuntimeStatus } from '../../shared/ipc.js'
import { RoutePicker, olderByGroup, unfoldedRows } from './components/RoutePicker.js'

/**
 * OLDER CLAUDE VERSIONS, FOLDED.
 *
 * Colin, 2026-09-22: "will the user be able to choose older models if theyd
 * like or are we limited to newest models?", then "folded claude models is
 * great, accessible but not crowding".
 */

const claude = {
  id: 'claude',
  displayName: 'Claude Code',
  installed: true,
  version: '2.1.280',
  auth: 'authenticated',
  ready: true,
  status: 'ready'
} as unknown as PublicRuntimeStatus

const current: PublicModel = { id: 'opus', runtime: 'claude', displayName: 'Opus 5.5', description: 'Always the newest Opus', supportedEfforts: [] }
const older = (id: string, name: string): PublicModel => ({ id, runtime: 'claude', displayName: name, description: 'This version, always', supportedEfforts: [], older: true })
const OLDER = [older('claude-opus-4-8', 'Opus 4.8'), older('claude-sonnet-4-6', 'Sonnet 4.6')]

const draw = (active: string): string =>
  renderToStaticMarkup(
    <RoutePicker
      runtimes={[claude]}
      limitedRuntimes={new Map()}
      models={[current, ...OLDER]}
      resolvedModels={new Map()}
      recentRoutes={[]}
      active={{ runtime: 'claude', model: active }}
      onSelect={() => undefined}
      onClose={() => undefined}
    />
  )

describe('the fold', () => {
  it('keeps older versions out of the list until it is opened, and says how many it holds', () => {
    const html = draw('opus')
    expect(html).toContain('>Opus 5.5<')
    expect(html).not.toContain('>Opus 4.8<')
    expect(html).not.toContain('>Sonnet 4.6<')
    expect(html).toMatch(/class="lc-picker__fold" aria-expanded="false"/)
    expect(html).toMatch(/Older versions<span class="lc-picker__foldcount lc-mono">2<\/span>/)
  })

  it('never folds away the route in use', () => {
    const html = draw('claude-opus-4-8')
    expect(html).toContain('>Opus 4.8<')
    // What is left under the fold is only the other one.
    expect(html).toMatch(/Older versions<span class="lc-picker__foldcount lc-mono">1<\/span>/)
  })

  it('lets a search reach into it without opening it', () => {
    const rows = [
      { group: 'Claude Code · your account', label: 'Opus 5.5' },
      { group: 'Claude Code · your account', label: 'Opus 4.8', older: true },
      { group: 'Recent', label: 'Opus 4.8', older: true }
    ]
    // Unsearched: the older row is folded, its recent shortcut is not.
    expect(unfoldedRows(rows, false).map((row) => `${row.group}/${row.label}`)).toEqual([
      'Claude Code · your account/Opus 5.5',
      'Recent/Opus 4.8'
    ])
    // Searched: everything that matched is shown.
    expect(unfoldedRows(rows, true)).toHaveLength(3)
    expect([...olderByGroup(rows).keys()]).toEqual(['Claude Code · your account'])
  })
})

describe('what the fold holds', () => {
  it("is Claude Code's own registry, newest first, with no retired generation", () => {
    expect(CLAUDE_OLDER_MODELS.map((model) => model.id)).toEqual([
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-fable-5',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5'
    ])
    expect(CLAUDE_OLDER_MODELS.some((model) => /claude-3|mythos/.test(model.id))).toBe(false)
  })

  it('offers each version only the effort levels its registry entry lists', () => {
    const levels = new Map(CLAUDE_OLDER_MODELS.map((model) => [model.id, model.efforts.join(',')]))
    expect(levels.get('claude-opus-4-8')).toBe('low,medium,high,xhigh,max')
    expect(levels.get('claude-opus-4-6')).toBe('low,medium,high,max')
    expect(levels.get('claude-sonnet-4-5')).toBe('')
  })
})
