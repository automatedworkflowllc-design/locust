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

  it('shows it for a table cell or a list item that is nothing but a colour (0.362)', () => {
    // A palette as a table was a column to imagine again (Write & design drive, 0.361).
    const table = renderToStaticMarkup(<AgentText text={['| Role | Hex |', '| --- | --- |', '| Crust | #C8A27A |', '| Flour | #F4EFE6 |'].join('\n')} streaming={false} />)
    expect(table).toContain('style="background-color:#C8A27A"')
    expect(table).toContain('style="background-color:#F4EFE6"')
    const list = renderToStaticMarkup(<AgentText text={['- #2E4A3F', '- #D98E73'].join('\n')} streaming={false} />)
    expect(list).toContain('style="background-color:#2E4A3F"')
    // Inside a sentence it is text, as GitHub draws it: "fixed in #123456" is not a colour.
    const prose = renderToStaticMarkup(<AgentText text={'Fixed in #123456 and the crust is #C8A27A now.'} streaming={false} />)
    expect(prose).not.toContain('lc-swatch')
  }, 10_000)

  it('shows it inside bold and italic, with no backticks left showing (0.362)', () => {
    // Iris's brand guide: "**Crust Brown `#6B4226`** -- Primary." drew its
    // backticks as characters and no swatch.
    const html = renderToStaticMarkup(<AgentText text={'- **Crust Brown `#6B4226`** — Primary.\n- *Berry Jam `#A63D40`* — accent.'} streaming={false} />)
    expect(html).toContain('style="background-color:#6B4226"')
    expect(html).toContain('style="background-color:#A63D40"')
    expect(html).not.toContain('`')
    expect(html).toMatch(/<strong><span>Crust Brown <\/span><code class="lc-code--inline">/)
    // And bold with nothing inside it is drawn exactly as it always was.
    expect(renderToStaticMarkup(<AgentText text={'**Plain bold.** After.'} streaming={false} />)).toContain('<strong>Plain bold.</strong>')
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
