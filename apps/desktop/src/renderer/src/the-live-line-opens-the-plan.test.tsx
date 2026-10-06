import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import { LiveRegisterLine, PlanPeek, PlanSteps } from './components/ThreadItems.js'
import THREAD_ITEMS from './components/ThreadItems.tsx?raw'
import { buildThread } from './missionView.js'
import type { PlanStep } from './missionView.js'

/**
 * THE LIVE LINE'S "STEP N OF M" OPENS THE PLAN (0.648).
 *
 * Colin, 2026-10-05: on a running turn with a plan, the plan card at the top
 * scrolls far out of view while the run works. The "step N of M" in the live
 * line becomes a control: hover (after 250 ms delay) or click/focus opens a
 * mini plan card above it. Escape or moving away closes it.
 */

let sequence = 0
const event = (type: string, payload: Record<string, unknown>): NormalizedRuntimeEvent => {
  sequence += 1
  return {
    id: `e${String(sequence)}`,
    runId: 'r',
    missionId: 'm',
    sequence,
    occurredAt: '2026-10-05T20:00:00.000Z',
    sourceAdapter: 'codex',
    type,
    payload: { evidence: { redacted: true }, ...payload }
  } as unknown as NormalizedRuntimeEvent
}

const planEvent = (states: readonly string[]): NormalizedRuntimeEvent =>
  event('plan.updated', {
    plan: {
      plan: states.map((status, index) => ({
        step: `Step ${String(index + 1)}`,
        status
      }))
    }
  })

const sampleSteps: readonly PlanStep[] = [
  { text: 'Inspect code', state: 'done' },
  { text: 'Apply fix', state: 'running' },
  { text: 'Run tests', state: 'pending' }
]

describe('the live line plan peek control', () => {
  it('the control is a button with its label and aria-expanded', () => {
    const html = renderToStaticMarkup(
      <LiveRegisterLine
        register="working"
        startedAt="2026-10-05T20:00:00.000Z"
        thinking={false}
        detail="step 2 of 3"
        plan={sampleSteps}
      />
    )
    expect(html).toContain('button type="button"')
    expect(html).toContain('class="lc-rail__meta lc-livestep__step is-control"')
    expect(html).toContain('aria-label="Show the plan, step 2 of 3"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('step 2 of 3')

    // CONTROL: without a plan, it is NOT a button and has no aria-expanded
    const noPlanHtml = renderToStaticMarkup(
      <LiveRegisterLine
        register="working"
        startedAt="2026-10-05T20:00:00.000Z"
        thinking={false}
        detail="step 2 of 3"
      />
    )
    expect(noPlanHtml).not.toContain('<button')
    expect(noPlanHtml).not.toContain('aria-expanded')
    expect(noPlanHtml).not.toContain('is-control')
    expect(noPlanHtml).toContain('step 2 of 3')
  })

  it('the card lists the steps in order with done/current/next marked', () => {
    const html = renderToStaticMarkup(
      <PlanSteps
        steps={sampleSteps}
        doneCount={1}
        outcomes
        underway
        compact
      />
    )
    // Compact card look
    expect(html).toContain('lc-plancard is-compact')

    // Steps appear in order
    const atDone = html.indexOf('Inspect code')
    const atRunning = html.indexOf('Apply fix')
    const atPending = html.indexOf('Run tests')
    expect(atDone).toBeGreaterThan(-1)
    expect(atRunning).toBeGreaterThan(atDone)
    expect(atPending).toBeGreaterThan(atRunning)

    // Step 1: done with check icon
    expect(html).toContain('is-done')

    // Step 2: running with aria-current="step", but without full orb (compact)
    expect(html).toContain('is-running')
    expect(html).toContain('aria-current="step"')
    expect(html).not.toContain('lc-plan__orb')

    // Step 3: pending
    expect(html).toContain('is-pending')

    // CONTROL: non-compact underway plan draws the head orb and step orb
    const fullHtml = renderToStaticMarkup(
      <PlanSteps
        steps={sampleSteps}
        doneCount={1}
        outcomes
        underway
        compact={false}
      />
    )
    expect(fullHtml).not.toContain('is-compact')
    expect(fullHtml).toContain('lc-plan__orb')
    expect(fullHtml).not.toContain('aria-current="step"')
  })

  it('closes on Escape and cleans up listeners', () => {
    // The component registers keydown and mousedown listeners when open,
    // and removes them on close or unmount
    expect(THREAD_ITEMS).toContain("if (event.key === 'Escape') setOpen(false)")
    expect(THREAD_ITEMS).toContain("document.addEventListener('keydown', onKey)")
    expect(THREAD_ITEMS).toContain("document.addEventListener('mousedown', onDown)")
    expect(THREAD_ITEMS).toContain("document.removeEventListener('keydown', onKey)")
    expect(THREAD_ITEMS).toContain("document.removeEventListener('mousedown', onDown)")
    expect(THREAD_ITEMS).toContain('PLAN_PEEK_DELAY_MS = 250')

    // CONTROL: verify that closing condition is specifically Escape
    expect(THREAD_ITEMS).not.toContain("if (event.key === 'Enter') setOpen(false)")
  })

  it('no card without a plan: plain step words with no button or popover', () => {
    const emptyPlan = renderToStaticMarkup(
      <PlanPeek label="step 1 of 1" steps={[]} />
    )
    expect(emptyPlan).not.toContain('<button')
    expect(emptyPlan).not.toContain('lc-livestep__peekcard')
    expect(emptyPlan).toContain('class="lc-rail__meta lc-livestep__step"')
    expect(emptyPlan).toContain('step 1 of 1')

    // CONTROL: with steps, the button control is rendered
    const withSteps = renderToStaticMarkup(
      <PlanPeek label="step 1 of 1" steps={sampleSteps} />
    )
    expect(withSteps).toContain('<button')
    expect(withSteps).toContain('is-control')
  })

  it('buildThread attaches the plan to live-step only when step N of M is present', () => {
    const events = [
      event('run.started', {}),
      planEvent(['completed', 'in_progress', 'pending']),
      event('tool.started', { itemId: 't', toolKind: 'command_execution', name: 'shell', command: 'npm test', phase: 'started' })
    ]
    const items = buildThread(events, { running: true })
    const live = items.find((item) => item.type === 'live-step')
    expect(live?.type === 'live-step').toBe(true)
    if (live?.type === 'live-step') {
      expect(live.detail).toBe('step 2 of 3')
      expect(live.plan).toHaveLength(3)
      expect(live.plan?.[0]?.state).toBe('done')
      expect(live.plan?.[1]?.state).toBe('running')
      expect(live.plan?.[2]?.state).toBe('pending')
    }

    // CONTROL: a run without a plan has no plan attached to live-step
    const noPlanItems = buildThread([event('run.started', {}), event('tool.started', { itemId: 't2', name: 'shell', phase: 'started' })], { running: true })
    const noPlanLive = noPlanItems.find((item) => item.type === 'live-step')
    if (noPlanLive?.type === 'live-step') {
      expect(noPlanLive.plan).toBeUndefined()
    }
  })
})
