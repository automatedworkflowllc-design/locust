import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { UsageMeters } from './components/UsageMeters.js'

/*
 * EVERY LIMIT SAYS WHAT IS LEFT (0.723). Settings > AI agents on the packaged 0.722: Antigravity's meters read
 * "100% left", "20% left", and Codex's, two cards below, "33% used" -- the same kind of bar in two languages,
 * because Codex reports what it has used. The bar was already the used part on both; the figure is now "left".
 */
describe('an agent’s limits', () => {
  it('say what is left, when the runtime reported what it used', () => {
    const html = renderToStaticMarkup(createElement(UsageMeters, { said: 'weekly window 33% used · 5-hour window 0% used', now: new Date('2026-10-10T12:00:00.000Z') }))
    expect(html).toContain('67% left')
    expect(html).toContain('100% left')
    expect(html).not.toContain('% used')
  })
})
