import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentText, hexColourOf } from './components/ThreadItems.js'

// First-impressions drive, 0.349: a design teammate's palette arrived as a
// column of hex codes a person had to imagine. Each now has its colour beside
// it -- and only an exact hex code ever reaches a style.
describe('a colour code in an answer', () => {
  it('shows its colour beside it', () => {
    const html = renderToStaticMarkup(<AgentText text={'The accent is `#7a9e8e` on paper `#F6F3EE`.'} streaming={false} />)
    expect(html).toContain('class="lc-swatch" style="background-color:#7a9e8e"')
    expect(html).toContain('style="background-color:#F6F3EE"')
  }, 10_000)

  it('draws nothing for code that is not exactly a colour', () => {
    const html = renderToStaticMarkup(<AgentText text={'Run `npm test`, see issue `#12a`, and `#7a9e8e;background:url(x)`.'} streaming={false} />)
    expect(html).not.toContain('lc-swatch')
  }, 10_000)

  it('accepts #rrggbb only, as GitHub does -- a short form may be an issue number', () => {
    expect(hexColourOf(' #a1b2c3 ')).toBe('#a1b2c3')
    expect(hexColourOf('#333333')).toBe('#333333')
    expect(hexColourOf('#123')).toBeUndefined()
    expect(hexColourOf('#abc')).toBeUndefined()
    expect(hexColourOf('#a1b2c3d4')).toBeUndefined()
    expect(hexColourOf('#ggg000')).toBeUndefined()
    expect(hexColourOf('red')).toBeUndefined()
    expect(hexColourOf('#ffffff) no-repeat, url(x')).toBeUndefined()
  }, 10_000)
})
