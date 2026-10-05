import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'

import { isStoppable } from './stopPress.js'
import { workSignature } from './useCoverActivity.js'

/**
 * THE COVER COUNTS ONLY WORK ARRIVING (0.623).
 *
 * Home holds its frame after 45 s without input -- unless something counts as
 * activity. The cover was handed the app's whole map of runs, which is rebuilt
 * on routine updates that are not work, so on the packaged build Home never
 * rested while focused (drive-home-rests.mjs, 50 s untouched: still
 * animating). What it is handed now is the signature of the runs going.
 */
describe('what the Home cover counts as work arriving', () => {
  const run = (phase: string, events: number) => ({ phase, events: Array.from({ length: events }, (_, at) => ({ at })) })

  it('is the same for a rebuilt map that holds the same runs', () => {
    const one = new Map([['run_a', run('running', 3)], ['run_b', run('completed', 9)]])
    const rebuilt = new Map([...one].map(([key, value]) => [key, { ...value, events: [...value.events] }]))
    expect(rebuilt).not.toBe(one)
    expect(workSignature(rebuilt, isStoppable)).toBe(workSignature(one, isStoppable))
  })

  it('changes when a running run gets an event, starts or ends', () => {
    const before = workSignature(new Map([['run_a', run('running', 3)]]), isStoppable)
    expect(workSignature(new Map([['run_a', run('running', 4)]]), isStoppable)).not.toBe(before)
    expect(workSignature(new Map([['run_a', run('running', 3)], ['run_b', run('starting', 0)]]), isStoppable)).not.toBe(before)
    expect(workSignature(new Map([['run_a', run('completed', 3)]]), isStoppable)).not.toBe(before)
  })

  it('is what the app hands the cover, never the map itself', () => {
    expect(APP).toContain('coverActivity={coverWork}')
    expect(APP).not.toContain('coverActivity={runs}')
  })

  it('is empty, for good, when nothing is running', () => {
    expect(workSignature(new Map([['run_a', run('completed', 12)], ['run_b', run('failed', 2)], ['run_c', run('cancelled', 1)]]), isStoppable)).toBe('')
    expect(workSignature(new Map(), isStoppable)).toBe('')
  })
})
