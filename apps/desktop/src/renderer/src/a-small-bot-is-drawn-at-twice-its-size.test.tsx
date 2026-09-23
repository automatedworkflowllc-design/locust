import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Bot, SUPERSAMPLE_AT_OR_BELOW } from './components/Bot.js'

/**
 * A SMALL BOT IS DRAWN AT TWICE ITS SIZE AND SHRUNK BY HALF.
 *
 * Colin, 2026-09-23 (A1): "the smaller renditions of the teammates have very
 * jagged edges from downscaling". The plastic is shaded per pixel at the
 * canvas's own resolution, so a 16px bot's edge pixel was body or background
 * and never between. Measured on frames of the sidebar: the share of a 16px
 * row bot's outline that is a blend went from 0.35 to 0.81, and the renderer
 * cost did not move (0.3-3.0% resting before, 0.1-3.2% after, over runs).
 */
describe('a bot in a small box', () => {
  it('is drawn at twice the size, inside a box of its own size', () => {
    const html = renderToStaticMarkup(<Bot type="ghost" size={16} />)
    expect(html).toContain('class="lc-bot__supersample" style="width:16px;height:16px"')
    expect(html).toContain('class="lc-bot__supersample-inner" style="width:32px;height:32px"')
  })

  it('is drawn as it is once the box has pixels to spare', () => {
    const html = renderToStaticMarkup(<Bot type="ghost" size={SUPERSAMPLE_AT_OR_BELOW + 1} />)
    expect(html).not.toContain('lc-bot__supersample')
  })
})
