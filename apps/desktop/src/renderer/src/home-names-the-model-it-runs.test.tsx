import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import { HomeTeam } from './components/HomeTeam.js'
import type { PublicModel } from '../../shared/ipc.js'
import { homeRouteOf, routeEffortOf, routeModelName } from './routeName.js'
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
    expect(APP).toContain('homeRouteOf(mate.route, resolvedModels, models)')
    expect(APP).not.toMatch(/route: routeChrome\(mate\.route\.runtime, mate\.route\.model, modelDisplayName/)
  })

  /*
   * THE LEVEL IS THE HOVER (0.386). Colin, 2026-09-27, over his Home: "some
   * teammates on home page not showing model effort" -- Robin's read "Grok
   * 4.7 Medium" because Cursor writes the level into the id; the two on Opus
   * said none. Then "whatever is best for user and design": every line names
   * the model alone, and the level is in the hover and the accessible name.
   */
  const OPUS: PublicModel = { id: 'opus', runtime: 'claude', displayName: 'Opus', description: 'Always the newest Opus', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' }
  const GROK: PublicModel = {
    id: 'grok-4.7-low',
    runtime: 'cursor',
    displayName: 'Grok 4.7',
    description: '',
    supportedEfforts: ['low', 'medium', 'high'],
    variants: { low: 'grok-4.7-low', medium: 'grok-4.7-medium', high: 'grok-4.7-high' }
  }
  const FLASH: PublicModel = { id: 'flash', runtime: 'antigravity', displayName: 'Gemini 3.8 Flash', description: 'Antigravity tier flash', supportedEfforts: [] }

  it("names the model alone on the line, every card alike, and the level in the whole route -- the one chosen, else the model's default", () => {
    const opus = homeRouteOf({ runtime: 'claude', model: 'opus' }, new Map(), [OPUS])
    expect(opus.model).toBe('Opus 5.5')
    expect(opus.route).toBe('Claude · Opus 5.5 · Medium')
    expect(homeRouteOf({ runtime: 'claude', model: 'opus', effort: 'xhigh' }, new Map(), [OPUS]).route).toBe('Claude · Opus 5.5 · Extra high')
  })

  it("names a Cursor family by the family, so its line carries no level where the others carry none", () => {
    const robin = homeRouteOf({ runtime: 'cursor', model: 'grok-4.7-medium' }, new Map(), [GROK])
    expect(robin.model).toBe('Grok 4.7')
    // The level its id carries, in the whole route -- said once. `-high`, so
    // it cannot pass as the family's default (medium) by coincidence.
    expect(robin.route).toBe('Cursor · Grok 4.7 · Medium')
    expect(homeRouteOf({ runtime: 'cursor', model: 'grok-4.7-high' }, new Map(), [GROK]).route).toBe('Cursor · Grok 4.7 · High')
  })

  it('says no level for a model that has none, and guesses none before the catalog has answered', () => {
    expect(homeRouteOf({ runtime: 'antigravity', model: 'flash' }, new Map(), [FLASH]).route).toBe('Antigravity · Gemini 3.8 Flash')
    expect(homeRouteOf({ runtime: 'claude', model: 'opus' }, new Map(), []).route).toBe('Claude · Opus 5.5')
    expect(routeEffortOf({ runtime: 'claude', model: 'opus' }, [])).toBeUndefined()
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

  it('with no model of its own, draws no route line and no mark', () => {
    const html = card({ teammateId: 'tm_new', name: 'Newt', hue: 'teal', avatar: seedAvatar('tm_new'), role: 'Docs & QA', working: false })
    // 0.723: no line rather than "runs on the model you pick" on every such card.
    expect(html).not.toContain('lc-hometeam__route')
    expect(html).not.toContain('runs on the model you pick')
    expect(html).not.toContain('lc-runtimemark')
  })
})
