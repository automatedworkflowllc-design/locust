import { describe, expect, it } from 'vitest'

import { PET_NEUTRAL, PET_ROWS } from '../../shared/pets.js'
import type { FaceActivity } from './faceState.js'
import { petCellAt, petGlanceCell, petNextChangeIn, petStateFor } from './petMotion.js'

/**
 * A PET SAYS WHAT ITS TEAMMATE IS DOING (0.563).
 *
 * Colin, 2026-10-03: "just clarity these should be the exact same as
 * teammates". A bot shows thinking, work, waiting on you, done and stuck; a
 * pet shows each with its own sheet's rows, by OpenPets' own map
 * (reaction-animation-mapping.ts) and its timings, and keeps Locust's rule
 * that a face at rest keeps still.
 */

describe('what a pet does for each thing its teammate does', () => {
  it('maps every activity to a row of its sheet', () => {
    const map: Record<FaceActivity, string> = {
      idle: 'idle',
      thinking: 'review',
      working: 'running',
      delegating: 'running',
      responding: 'running',
      receiving: 'waving',
      waiting: 'waiting',
      done: 'jumping',
      blocked: 'failed'
    }
    for (const [activity, state] of Object.entries(map)) expect(petStateFor(activity as FaceActivity), activity).toBe(state)
  })
})

describe('the frame a pet shows', () => {
  it('rests in its resting pose -- version 2’s own, version 1’s first idle frame', () => {
    expect(petCellAt('idle', 12_345, 11, false)).toMatchObject({ row: PET_NEUTRAL.row, column: PET_NEUTRAL.column, settled: true })
    expect(petCellAt('idle', 12_345, 9, false)).toMatchObject({ row: 0, column: 0, settled: true })
    expect(petNextChangeIn('idle', 0, false)).toBeUndefined()
  })

  it('loops work and thought through their rows at OpenPets’ pace', () => {
    const running = PET_ROWS.running
    const step = running.ms / running.frames
    expect(petCellAt('running', 0, 11, false)).toMatchObject({ row: running.row, column: 0, settled: false })
    expect(petCellAt('running', step * 2 + 1, 11, false).column).toBe(2)
    // Round again after one pass.
    expect(petCellAt('running', running.ms + 1, 11, false).column).toBe(0)
    expect(petNextChangeIn('running', step / 2, false)).toBeCloseTo(step / 2)
    expect(petCellAt('review', 0, 11, false).row).toBe(PET_ROWS.review.row)
    expect(petCellAt('waiting', 0, 11, false).row).toBe(PET_ROWS.waiting.row)
  })

  it('waves and jumps twice, then rests', () => {
    for (const state of ['waving', 'jumping'] as const) {
      const spec = PET_ROWS[state]
      expect(petCellAt(state, spec.ms + 1, 11, false)).toMatchObject({ row: spec.row, shown: state, settled: false })
      const after = petCellAt(state, spec.ms * 2 + 1, 11, false)
      expect(after).toMatchObject({ row: PET_NEUTRAL.row, column: PET_NEUTRAL.column, shown: 'idle', settled: true })
      expect(petNextChangeIn(state, spec.ms * 2 + 1, false)).toBeUndefined()
    }
  })

  it('fails twice, then holds its lowest moment while the teammate stays stuck', () => {
    const spec = PET_ROWS.failed
    const held = petCellAt('failed', spec.ms * 2 + 1, 11, false)
    expect(held).toMatchObject({ row: spec.row, column: Math.floor(spec.frames / 2), shown: 'failed', settled: true })
    expect(petCellAt('failed', 60_000, 9, false)).toEqual(held)
  })

  it('holds still for reduced motion: a pose, never a row half played', () => {
    expect(petCellAt('running', 400, 11, true)).toMatchObject({ row: PET_ROWS.running.row, column: 0, settled: true })
    expect(petCellAt('failed', 0, 11, true).column).toBe(Math.floor(PET_ROWS.failed.frames / 2))
    expect(petNextChangeIn('running', 400, true)).toBeUndefined()
  })
})

describe('a pet glancing at a teammate', () => {
  it('turns a version 2 head toward it, left, right or up', () => {
    expect(petGlanceCell('right', 11)).toMatchObject({ row: 9, column: 4 })
    expect(petGlanceCell('left', 11)).toMatchObject({ row: 10, column: 4 })
    expect(petGlanceCell('up', 11)).toMatchObject({ row: 9, column: 0 })
  })

  it('keeps its pose where its sheet has no head to turn, or would show the back of it', () => {
    expect(petGlanceCell('right', 9)).toBeUndefined()
    expect(petGlanceCell('down', 11)).toBeUndefined()
  })
})
