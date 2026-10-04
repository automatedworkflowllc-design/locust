import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlanSteps } from './components/ThreadItems.js'

/**
 * A CHECKLIST LEFT UNTICKED IS NOT A FAULT (0.368).
 *
 * Quill, the Write & design team's writer, was asked for five questions and
 * then a page. It asked them, ended "Reply with your answers and I'll draft
 * the page", and its plan card read "0 of 2 done · 2 not checked off" in
 * amber -- the colour this app keeps for interrupted and needs-you -- over a
 * pause that was right to make (first session, packaged 0.366). The count
 * is still said: the run planned two steps and ticked neither, which is
 * true. Amber is kept for a run that failed or was stopped before its list
 * was closed.
 */
const STEPS = [
  { text: 'Ask five questions about the business', state: 'running' as const },
  { text: 'Write a one-page introduction', state: 'pending' as const }
]

describe('the plan card after a run', () => {
  it('says what was left unticked, in its own voice, after a run that completed', () => {
    const html = renderToStaticMarkup(<PlanSteps steps={STEPS} doneCount={0} outcomes finished />)
    expect(html).toContain('2 not checked off')
    expect(html).toContain('class="lc-plancard__unreached"')
    expect(html).not.toContain('is-stopped')
  }, 10_000)

  it('keeps amber for a run that failed or was stopped', () => {
    const html = renderToStaticMarkup(<PlanSteps steps={STEPS} doneCount={0} outcomes finished stopped />)
    expect(html).toContain('class="lc-plancard__unreached is-stopped"')
    expect(html).toContain('The run stopped before checking these off its list')
  }, 10_000)

  it('says nothing of the kind while the run goes on', () => {
    const html = renderToStaticMarkup(<PlanSteps steps={STEPS} doneCount={0} outcomes underway />)
    expect(html).not.toContain('not checked off')
  }, 10_000)
})
