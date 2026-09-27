import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { LocalRuntimeId, PublicRuntimeStatus } from '../../shared/ipc.js'
import { Composer } from './components/Composer.js'
import type { ComposerProps } from './components/Composer.js'
import { FirstLaunch } from './components/FirstLaunch.js'
import { UsageRing } from './components/UsageRing.js'

/**
 * AN ACCOUNT SHOWS HOW FULL IT IS (0.388).
 *
 * Orca's status bar shows each account's usage; Locust shows what the runs
 * themselves reported (Claude's windows, and Codex's since 0.388) as a thin
 * ring round the runtime's mark -- on Home's agents line always, and on the
 * model button only from 80%, where the amber dot used to be.
 */
const RESETS = '2026-09-27T22:10:00.000Z'
const ready = (id: LocalRuntimeId, name: string): PublicRuntimeStatus => ({ id, displayName: name, installed: true, version: '1.0.0', auth: 'authenticated', ready: true, status: 'ready' })

describe('the ring', () => {
  const ring = (used: number): string => renderToStaticMarkup(<UsageRing used={used} size={15}><span /></UsageRing>)

  it('fills in proportion, from the top', () => {
    const half = ring(50)
    const around = 2 * Math.PI * ((15 + 8) / 2 - 1)
    expect(half).toContain(`stroke-dasharray="${(around / 2).toFixed(2)} ${around.toFixed(2)}"`)
    expect(half).toContain('transform="rotate(-90 11.5 11.5)"')
    expect(half).toContain('data-used="50"')
  })

  it('draws no arc at 0% -- a round cap on nothing is a stray dot -- only the track', () => {
    expect(ring(0)).not.toContain('lc-usagering__arc')
    expect(ring(0)).toContain('lc-usagering__track')
    expect(ring(1)).toContain('lc-usagering__arc')
  })

  it('is muted with room left, amber from 80%, red when spent', () => {
    expect(ring(79)).toContain('class="lc-usagering"')
    expect(ring(80)).toContain('class="lc-usagering is-pressing"')
    expect(ring(100)).toContain('class="lc-usagering is-spent"')
  })
})

describe("Home's agents line", () => {
  it('rings each account a run has reported on, and names the reading; the others are their marks alone', () => {
    const html = renderToStaticMarkup(
      <FirstLaunch
        runtimes={[ready('codex', 'Codex CLI'), ready('claude', 'Claude Code')]}
        limitedRuntimes={new Map()}
        usageWindows={new Map([['claude', `5-hour window 35% used · resets ${RESETS} · 7-day window 12% used`]])}
        discoveryPhase="ready"
        workspacePath="C:\\work"
        teammateCount={1}
        team={[]}
        onMessageTeammate={() => undefined}
        onChooseFolder={() => undefined}
        onInstall={() => undefined}
      />
    )
    expect(html).toMatch(/<span class="lc-usagering" [^>]*data-used="35"><svg[^]*?<svg class="lc-runtimemark"[^>]*data-runtime="claude"[^>]*aria-label="Claude Code: 35% of the 5-hour window used, resets [^"]+ · 12% of the 7-day window"/)
    expect(html).toContain('aria-label="Codex CLI"')
    expect([...html.matchAll(/lc-usagering"/g)]).toHaveLength(1)
  })
})

function chip(used: number | undefined): string {
  const props = {
    runtimes: [ready('claude', 'Claude Code')],
    limitedRuntimes: new Map(),
    usageWindows: used === undefined ? new Map() : new Map([['claude', `5-hour window ${String(used)}% used · resets ${RESETS}`]]),
    discoveryPhase: 'ready',
    models: [],
    resolvedModels: new Map(),
    route: { runtime: 'claude', model: 'sonnet', routeId: 'claude:sonnet' },
    mode: 'accept-edits',
    onModeChange: () => undefined,
    onRouteChange: () => undefined,
    onSend: () => undefined,
    running: false,
    platform: 'win32'
  } as unknown as ComposerProps
  const html = renderToStaticMarkup(<Composer {...props} />)
  const start = html.lastIndexOf('<button', html.indexOf('aria-haspopup="listbox"'))
  return html.slice(start, html.indexOf('</button>', start))
}

describe('the model button', () => {
  it('stays quiet with room left: no ring, no dot', () => {
    expect(chip(40)).not.toContain('lc-usagering')
    expect(chip(40)).not.toContain('is-pressing')
  })

  it('rings the mark in amber from 80%, where the dot was -- and draws the dot no more', () => {
    const pressing = chip(85)
    expect(pressing).toMatch(/<span class="lc-usagering is-pressing"[^>]*data-used="85"><svg[^]*data-runtime="claude"/)
    expect(pressing).not.toMatch(/class="lc-control lc-control--boxed is-pressing"/)
    expect(chip(100)).toContain('class="lc-usagering is-spent"')
  })
})
