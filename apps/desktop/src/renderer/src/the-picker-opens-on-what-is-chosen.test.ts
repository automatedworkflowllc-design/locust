import { describe, expect, it } from 'vitest'

import picker from './components/RoutePicker.tsx?raw'

/**
 * THE MODEL PICKER OPENS ON WHAT IS CHOSEN (0.411, fresh-eyes check). It
 * opened at the top of its list whatever the teammate was on; a teammate on an
 * OpenCode free model had to scroll to find its own route. drive-the-chat-box
 * measures the chosen row in view at 1440x900 and 1120x720.
 */
describe('the model picker, opened', () => {
  it('scrolls its list to the chosen row when that row is out of view', () => {
    expect(picker).toContain("list?.querySelector<HTMLElement>('.lc-picker__row.is-active')")
    expect(picker).toContain('list.scrollTop += at.top - box.top - (box.height - at.height) / 2')
    expect(picker).toContain('<div className="lc-picker__list" ref={listRef}>')
  })

  it('does it once per opening, and never while a search is typed', () => {
    expect(picker).toContain('if (shownChosen.current || searching) return')
    expect(picker).toContain('shownChosen.current = true')
  })
})
