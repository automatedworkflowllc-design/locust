import { describe, expect, it } from 'vitest'

import { buildThread } from './missionView.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * Having spawned a process is not the same as work happening.
 *
 * `run.started` is the APP's own record of launching something. It is the
 * first event in almost every mission and it says nothing about the runtime.
 * The live line's word was read off `events.length === 0`, so one event
 * later -- the app's own -- the line said **Working**, on the strength of
 * Locust having spawned a child process.
 *
 * The run this is about is already in the repository, quoted in `quiet.ts`:
 * `mission_3848a498`, `run.started` at 3.5s and then not one runtime event
 * until 128.7s. The line read "working" for over two minutes of silence, and
 * that frame is what Colin sent on 2026-09-13.
 *
 * The honest fact was already being computed one line below, as `spoken`,
 * to decide whether to add the quiet sentence. The word above it went on
 * being drawn from the proxy. This is that class of defect -- a drawing
 * decision made from something NEAR the fact rather than the fact -- and it
 * is the third of its kind found this week, after a to-do list drawn as an
 * answer and a wrapped bullet drawn as a paragraph.
 */

const at = '2026-09-19T10:00:00.000Z'
const event = (type: string): NormalizedRuntimeEvent =>
  ({ id: `e-${type}`, runId: 'r', missionId: 'm', sequence: 1, occurredAt: at, sourceAdapter: 'cursor', type, payload: {} }) as unknown as NormalizedRuntimeEvent

const liveLine = (events: readonly NormalizedRuntimeEvent[]) =>
  buildThread(events, { running: true, mayEdit: true, startedAt: at }).find((item) => item.type === 'live-step') as
    | { readonly label: string; readonly register: string; readonly spoken?: boolean }
    | undefined

describe('the word on a run that has not been answered yet', () => {
  it('says Starting while the app has only recorded launching it', () => {
    const line = liveLine([event('run.started')])
    expect(line?.label).toBe('Starting')
    expect(line?.register).toBe('starting')
    expect(line?.spoken).toBe(false)
  })

  it('says Starting before even that', () => {
    const line = liveLine([])
    expect(line?.label).toBe('Starting')
  })

  it('says Working once the runtime itself has said something', () => {
    // The control. A change that simply always said "Starting" would be the
    // same defect pointing the other way, and this is the ordinary case.
    const line = liveLine([event('run.started'), event('step.completed')])
    expect(line?.label).toBe('Working')
    expect(line?.register).toBe('working')
    expect(line?.spoken).toBe(true)
  })

  it('draws its word and its quiet sentence from one fact', () => {
    /*
     * The two must never disagree. They did: `spoken` was added to say "and
     * nothing has come back yet" underneath a line that had already claimed
     * work was happening, so the card could state both at once.
     */
    for (const events of [[], [event('run.started')], [event('run.started'), event('step.completed')]]) {
      const line = liveLine(events)
      expect(line?.label === 'Working').toBe(line?.spoken === true)
    }
  })
})
