import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import { HomeTeam } from './components/HomeTeam.js'
import { homeRouteOf, routeModelName } from './routeName.js'
import APP from './App.tsx?raw'

/**
 * HOME NAMES THE MODEL A TEAMMATE RUNS (0.384).
 *
 * Colin, 2026-09-26, with a frame of his Home: "opus model type isnt showing
 * up on agents (5.5) and flash we can definitely have it there, its 3.8 now".
 * The cards read "Claude · Opus" and "Antigravity · Flash" -- the alias and
 * the tier, spelled -- while the Team screen and the chip said "Opus 5.5". And
 * "Cursor · Grok 4.7 Mediu..." was cut short.
 */
describe("a teammate's route on Home", () => {
  it('names the version an alias runs, as the Team screen does', () => {
    const line = homeRouteOf({ runtime: 'claude', model: 'opus' }, new Map())
    expect(line.model).toBe('Opus 5.5')
    expect(line.route).toBe('Claude · Opus 5.5')
    expect(line.runtime).toBe('claude')
    expect(line.model).toBe(routeModelName('claude', 'opus'))
  })

  it("names Antigravity's Flash tier by the model it runs, and guesses no version for the others", () => {
    expect(homeRouteOf({ runtime: 'antigravity', model: 'flash' }, new Map()).route).toBe('Antigravity · Gemini 3.8 Flash')
    expect(routeModelName('antigravity', 'pro')).toBe('Gemini Pro')
    expect(routeModelName('antigravity', 'flash_lite')).toBe('Gemini Flash Lite')
    // Not a tier: said as itself, the way any unknown id is.
    expect(routeModelName('antigravity', 'account-default')).toBe('Account Default')
  })

  it("is what Home's cards are given -- not the alias, spelled", () => {
    expect(APP).toContain('homeRouteOf(mate.route, resolvedModels)')
    expect(APP).not.toMatch(/route: routeChrome\(mate\.route\.runtime, mate\.route\.model, modelDisplayName/)
  })

  it("shows no maker's mark for a model of the person's own", () => {
    const line = homeRouteOf({ runtime: 'opencode', model: 'own-1a2b3c4d/acme-70b' }, new Map())
    expect(line.runtime).toBeUndefined()
  })
})

describe("Home's teammate card", () => {
  const card = (mate: Parameters<typeof HomeTeam>[0]['team'][number]): string =>
    renderToStaticMarkup(<HomeTeam team={[mate]} onMessage={() => undefined} />)

  it("shows the runtime as its mark and the model in words, the whole route on hover and for a screen reader", () => {
    const html = card({
      teammateId: 'tm_robin',
      name: 'Robin',
      hue: 'lime',
      avatar: seedAvatar('tm_robin'),
      role: 'Finance Bro',
      working: false,
      ...homeRouteOf({ runtime: 'cursor', model: 'grok-4.7-medium' }, new Map())
    })
    const line = /<span class="lc-hometeam__route"[^>]*>(.*?)<\/span>/.exec(html)?.[1] ?? ''
    expect(line).toMatch(/^<svg[^>]*data-runtime="cursor"/)
    // The words are the model alone: the mark already said Cursor.
    expect(line.replace(/<svg.*<\/svg>/, '')).toBe('Grok 4.7 Medium')
    expect(html).toContain('title="Cursor · Grok 4.7 Medium"')
    expect(html).toContain('aria-label="Message Robin, Finance Bro, on Cursor · Grok 4.7 Medium"')
  })

  it('before a first run, says so, with no mark', () => {
    const html = card({ teammateId: 'tm_new', name: 'Newt', hue: 'teal', avatar: seedAvatar('tm_new'), role: 'Docs & QA', working: false })
    expect(html).toContain('runs on the model you pick')
    expect(html).not.toContain('lc-runtimemark')
  })
})
