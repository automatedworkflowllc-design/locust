import { describe, expect, it } from 'vitest'

import { ANTIGRAVITY_TIER_NAMES } from '../shared/antigravity-models.js'
import { ANTIGRAVITY_MODELS } from './antigravity-host.js'
import { ANTIGRAVITY_TIERS } from './antigravity-mission.js'

/*
 * ANTIGRAVITY'S TIERS ARE NAMED ONCE (0.384).
 *
 * The picker lists them from the host's catalog and every card names a route
 * through the window's `routeModelName`; both read one table, so "Gemini 3.8
 * Flash" in the picker cannot sit beside "Flash" on a card again.
 */
describe("Antigravity's tiers", () => {
  it('are exactly the three its own --help offers (flash_lite, flash, pro)', () => {
    expect([...ANTIGRAVITY_TIERS].sort()).toEqual(['flash', 'flash_lite', 'pro'])
    expect(Object.keys(ANTIGRAVITY_TIER_NAMES).sort()).toEqual(['flash', 'flash_lite', 'pro'])
  })

  it('are listed in the catalog by the same names the window uses', () => {
    for (const model of ANTIGRAVITY_MODELS) expect(model.displayName, model.id).toBe(ANTIGRAVITY_TIER_NAMES[model.id])
    expect(ANTIGRAVITY_MODELS.find((model) => model.id === 'flash')?.displayName).toBe('Gemini 3.8 Flash')
  })
})
