import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CancellationCard } from './components/CancellationCard.js'

// Code review B4, renderer-thread (f): a run stopped by a teammate's message
// (the relay's interrupt) was titled "You stopped this run".
describe('who the stop card says stopped the run', () => {
  const summary = { settled: ['Read README.md'], interrupted: [], neverStarted: 0 }

  it('says "You" for a Stop the person pressed', () => {
    const html = renderToStaticMarkup(<CancellationCard summary={summary} stoppedAt="05:08 PM" byPerson />)
    expect(html).toContain('You stopped this run at 05:08 PM')
  }, 10_000)

  it('does not, for a run stopped by anything else', () => {
    const html = renderToStaticMarkup(<CancellationCard summary={summary} stoppedAt="05:08 PM" byPerson={false} />)
    expect(html).toContain('This run was stopped at 05:08 PM')
    expect(html).not.toContain('You stopped')
  }, 10_000)
})
