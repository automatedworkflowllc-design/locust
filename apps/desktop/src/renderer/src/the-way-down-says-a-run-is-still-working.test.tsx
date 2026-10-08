import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JumpToBottom } from './components/JumpToBottom.js'

const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8')

describe('the way down says a run is still working (0.703)', () => {
  it('wears the thinking dots while the run works, and says so to a screen reader', () => {
    const html = renderToStaticMarkup(<JumpToBottom shown working onClick={() => undefined} />)
    expect(html).toContain('lc-jumpdown--working')
    expect(html).toContain('class="lc-dots lc-jumpdown__dots"')
    expect(html).toContain('aria-label="Still working. Go to the newest message"')
  })
  it('is the plain chevron when nothing is running, and absent at the bottom', () => {
    const html = renderToStaticMarkup(<JumpToBottom shown onClick={() => undefined} />)
    expect(html).not.toContain('lc-dots')
    expect(html).toContain('aria-label="Go to the newest message"')
    expect(renderToStaticMarkup(<JumpToBottom shown={false} working onClick={() => undefined} />)).toBe('')
  })
  it('brings the chevron back on hover and keyboard focus, where it is about to be pressed', () => {
    expect(css).toMatch(/\.lc-jumpdown--working \.lc-jumpdown__chevron,\s*\.lc-jumpdown--working:hover \.lc-jumpdown__dots,\s*\.lc-jumpdown--working:focus-visible \.lc-jumpdown__dots \{\s*display: none;/)
    expect(css).toMatch(/\.lc-jumpdown--working:hover \.lc-jumpdown__chevron,\s*\.lc-jumpdown--working:focus-visible \.lc-jumpdown__chevron \{\s*display: flex;/)
  })
})
