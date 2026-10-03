import { PET_NEUTRAL, PET_ROWS, petGazeCell } from '../../shared/pets.js'
import type { PetRows, PetState } from '../../shared/pets.js'
import type { FaceActivity } from './faceState.js'
import type { GlanceSide } from './glances.js'

/**
 * WHAT A PET DOES FOR WHAT ITS TEAMMATE IS DOING (0.563).
 *
 * Colin, 2026-10-03: "just clarity these should be the exact same as
 * teammates". So a pet says everything a bot says, in its own sheet's rows --
 * OpenPets' own map from an agent's state to a row (reaction-animation-
 * mapping.ts: thinking reviews, work runs, waiting waits, success jumps, an
 * error fails), and Locust's rules for when a face moves:
 *
 *   - idle: still, in its resting pose -- a bot at rest keeps still too
 *     (Colin: "ill run with your suggestion").
 *   - thinking: the review row, looping.
 *   - working, delegating, answering: the running row, which is work in
 *     place, looping.
 *   - receiving a message: a wave, twice, then rest.
 *   - waiting on you: the waiting row, looping, inside the amber ring.
 *   - done: the jump, twice -- the done hop -- then rest.
 *   - stuck: the failure, twice, then held on its lowest moment, so a stuck
 *     teammate looks stuck until someone helps.
 */
export function petStateFor(activity: FaceActivity): PetState {
  switch (activity) {
    case 'thinking':
      return 'review'
    case 'working':
    case 'delegating':
    case 'responding':
      return 'running'
    case 'receiving':
      return 'waving'
    case 'waiting':
      return 'waiting'
    case 'done':
      return 'jumping'
    case 'blocked':
      return 'failed'
    case 'idle':
      return 'idle'
  }
}

/** A cell of the sheet, and the state it shows (a finished wave or jump shows rest). */
export interface PetCell {
  readonly row: number
  readonly column: number
  readonly shown: PetState
  /** Nothing more will change: the clock can stop. */
  readonly settled: boolean
}

/** The resting pose: version 2's own (row 0, column 6), version 1's first idle frame. */
export function restingCell(rows: PetRows): PetCell {
  return rows === 11
    ? { row: PET_NEUTRAL.row, column: PET_NEUTRAL.column, shown: 'idle', settled: true }
    : { row: PET_ROWS.idle.row, column: 0, shown: 'idle', settled: true }
}

/** The failure's lowest moment, held while a teammate stays stuck: the middle of its row. */
export function heldFailureCell(): PetCell {
  return { row: PET_ROWS.failed.row, column: Math.floor(PET_ROWS.failed.frames / 2), shown: 'failed', settled: true }
}

/**
 * The cell to draw `elapsed` ms after the state began. Still (reduced
 * motion, or a face that keeps still): the resting pose, the held failure,
 * or the state's first frame.
 */
export function petCellAt(state: PetState, elapsed: number, rows: PetRows, still: boolean): PetCell {
  if (state === 'idle') return restingCell(rows)
  const spec = PET_ROWS[state]
  if (still) return state === 'failed' ? heldFailureCell() : { row: spec.row, column: 0, shown: state, settled: true }
  const frameMs = spec.ms / spec.frames
  const time = Math.max(0, elapsed)
  if (spec.plays !== undefined && time >= spec.ms * spec.plays) {
    return state === 'failed' ? heldFailureCell() : restingCell(rows)
  }
  return { row: spec.row, column: Math.floor(time / frameMs) % spec.frames, shown: state, settled: false }
}

/**
 * HOW LONG ONE DRAWING MELTS INTO THE NEXT (0.564). Colin, after 0.563: *"we
 * should try to smooth out the animations a bit like they are with the other
 * teammates"*. A pet's rows step 6-8 drawings a movement; bots move at 30 a
 * second. Each new drawing appears with the last one fading off it over about
 * half a frame (at most 80 ms), so the steps read as movement, not flicker.
 * None at rest or when still: nothing moves there.
 */
export const PET_FADE_MAX_MS = 80

export function petFadeMs(state: PetState, still: boolean): number {
  if (still || state === 'idle') return 0
  const spec = PET_ROWS[state]
  return Math.min(PET_FADE_MAX_MS, Math.round(spec.ms / spec.frames / 2))
}

/** How long until the next cell, or undefined once nothing more will change. */
export function petNextChangeIn(state: PetState, elapsed: number, still: boolean): number | undefined {
  if (state === 'idle' || still) return undefined
  const spec = PET_ROWS[state]
  const frameMs = spec.ms / spec.frames
  const time = Math.max(0, elapsed)
  if (spec.plays !== undefined && time >= spec.ms * spec.plays) return undefined
  return frameMs - (time % frameMs)
}

/**
 * A pet looking toward a teammate it just handed a message to (glances.ts):
 * a version 2 sheet's head turned that way -- right 4, left 12, up 0. Not
 * down: some pets' makers drew the back of the head for it.
 */
export function petGlanceCell(side: GlanceSide, rows: PetRows): PetCell | undefined {
  if (rows !== 11) return undefined
  const index = side === 'right' ? 4 : side === 'left' ? 12 : side === 'up' ? 0 : undefined
  if (index === undefined) return undefined
  const cell = petGazeCell(index)
  return cell === undefined ? undefined : { row: cell.row, column: cell.column, shown: 'idle', settled: true }
}
