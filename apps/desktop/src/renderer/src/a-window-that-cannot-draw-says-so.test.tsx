import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { WindowFallback } from './components/WindowFallback.js'

/**
 * A WINDOW THAT CANNOT BE DRAWN SAYS SO (0.543, the 0.536 code review UI-01).
 * Nothing caught a render that threw, so the window went blank with nothing
 * to press. The boundary turns that into a sentence and a reload.
 */
describe('the window fallback', () => {
  it('draws its children while nothing has failed', () => {
    expect(renderToStaticMarkup(<WindowFallback>{'the app'}</WindowFallback>)).toBe('the app')
  })

  it('once a render throws, says what happened and offers the reload', () => {
    expect(WindowFallback.getDerivedStateFromError()).toEqual({ failed: true })
    const boundary = new WindowFallback({ children: 'the app' })
    boundary.state = { failed: true }
    const shown = renderToStaticMarkup(boundary.render() as ReactElement)
    expect(shown).toContain('Locust could not draw this window')
    expect(shown).toContain('Your conversations and teammates are saved.')
    expect(shown).toContain('Reload the window')
    expect(shown).not.toContain('the app')
  })
})
