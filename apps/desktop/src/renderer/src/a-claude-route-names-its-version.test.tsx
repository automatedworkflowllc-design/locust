import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CLAUDE_ALIAS_DEFAULTS, claudeModelName, claudeRouteModelName } from '../../shared/claude-models.js'
import type { PublicModel, PublicRuntimeStatus } from '../../shared/ipc.js'
import { RoutePicker } from './components/RoutePicker.js'
import { modelDisplayName, routeModelName } from './routeName.js'

/**
 * A CLAUDE ROUTE NAMES THE VERSION IT RUNS.
 *
 * Colin, 2026-09-22: "can we have the model type listed for claude? right now
 * it just shows opus latest model, fable latest model". On 2026-09-11 he had
 * written the chip out: "Claude / Fable 5.1".
 */

describe('how a Claude model id reads', () => {
  it('spells family and version the way Anthropic writes them', () => {
    expect(claudeModelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(claudeModelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(claudeModelName('claude-sonnet-5')).toBe('Sonnet 5')
    // A dated id, and a provider's suffix, are the same model.
    expect(claudeModelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(claudeModelName('claude-opus-4-1-20250805-v1')).toBe('Opus 4.1')
    expect(claudeModelName('claude-opus-4-20250514')).toBe('Opus 4')
  })

  it('guesses at nothing it does not recognise', () => {
    expect(claudeModelName('opus')).toBeUndefined()
    expect(claudeModelName('claude-fable-5-mythos-5')).toBeUndefined()
    expect(claudeModelName('gpt-6')).toBeUndefined()
  })

  it("carries Claude Code's own alias table (2.1.293: Haiku 5.5)", () => {
    expect(CLAUDE_ALIAS_DEFAULTS).toEqual({
      fable: 'claude-fable-5-1',
      opus: 'claude-opus-5-5',
      sonnet: 'claude-sonnet-5-5',
      haiku: 'claude-haiku-5-5'
    })
  })
})

describe('what a route reads as', () => {
  it('is the version the alias means, until a run on it says otherwise', () => {
    expect(claudeRouteModelName('opus')).toBe('Opus 5.5')
    // A gateway maps opus elsewhere; the run's own report wins.
    expect(claudeRouteModelName('opus', 'claude-opus-4-7')).toBe('Opus 4.7')
    // A pinned full id reads as itself.
    expect(claudeRouteModelName('claude-opus-4-8')).toBe('Opus 4.8')
  })

  it("takes Claude Code's own name for it over the copied table, and a run's report over both (0.697)", () => {
    // Colin, 2026-10-07: "haiku 5.5 is appearing on cursor but not claude on locust".
    expect(claudeRouteModelName('haiku', undefined, 'Haiku 6')).toBe('Haiku 6')
    expect(claudeRouteModelName('haiku', 'claude-haiku-4-5-20251001', 'Haiku 6')).toBe('Haiku 4.5')
    expect(claudeRouteModelName('haiku', undefined, '')).toBe('Haiku 5.5')
  })

  it('names the version on the controls that pick a route, and nothing else changes', () => {
    expect(routeModelName('claude', 'fable')).toBe('Fable 5.1')
    expect(routeModelName('claude', 'opus', 'claude-opus-5-5-20260901')).toBe('Opus 5.5')
    expect(routeModelName('cursor', 'cursor-grok-4.6')).toBe('Grok 4.6')
    // A past mission's row keeps the alias it ran on: what "opus" meant in
    // August is not today's version.
    expect(modelDisplayName('claude', 'opus')).toBe('Opus')
  })
})

describe('the picker', () => {
  const claude: PublicRuntimeStatus = {
    id: 'claude',
    displayName: 'Claude Code',
    installed: true,
    version: '2.1.280',
    auth: 'authenticated',
    ready: true,
    status: 'ready'
  } as unknown as PublicRuntimeStatus
  const opus: PublicModel = { id: 'opus', runtime: 'claude', displayName: 'Opus 5.5', description: 'Always the newest Opus', supportedEfforts: [] }
  const draw = (resolved: ReadonlyMap<string, string>): string =>
    renderToStaticMarkup(
      <RoutePicker
        runtimes={[claude]}
        limitedRuntimes={new Map()}
        models={[opus]}
        resolvedModels={resolved}
        recentRoutes={[]}
        active={{ runtime: 'claude', model: 'opus' }}
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    )

  it('labels the row with the version', () => {
    expect(draw(new Map())).toContain('>Opus 5.5<')
  })

  it('believes a finished run over the table', () => {
    const html = draw(new Map([['claude:opus', 'claude-opus-4-7']]))
    expect(html).toContain('>Opus 4.7<')
    expect(html).not.toContain('>Opus 5.5<')
  })
})
