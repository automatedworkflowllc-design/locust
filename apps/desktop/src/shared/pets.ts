/**
 * THE PET SHEET FORMAT (0.563), shared by the host that checks a sheet before
 * keeping it and the window that draws it.
 *
 * Ported from OpenPets (https://github.com/OpenPetsHQ/openpets, MIT, (c) 2026
 * OpenPets) at commit 2d14120cf027c9e80db7ff78e60711be08d39df4:
 * `codex-pets-core.ts` (the layouts, the neutral pose, the gaze cells) and
 * `reaction-animation-mapping.ts` (each animation's row, frames and timing).
 * A pet is the format Codex uses for its pets: `pet.json` beside
 * `spritesheet.webp`, an atlas of 8 columns of 192 x 208 frames -- 9 rows,
 * or 11 for a version 2 sheet, whose last two rows are a head turned toward
 * each of 16 directions.
 */

export const PET_COLUMNS = 8
export const PET_FRAME_WIDTH = 192
export const PET_FRAME_HEIGHT = 208

/** A version 2 sheet: exactly this size, and transparent (OpenPets refuses anything else). */
export const PET_V2_WIDTH = PET_COLUMNS * PET_FRAME_WIDTH
export const PET_V2_HEIGHT = 11 * PET_FRAME_HEIGHT

export type PetRows = 9 | 11

export interface PetSheetSize {
  readonly width: number
  readonly height: number
  readonly alpha: boolean
  readonly animated: boolean
}

/**
 * Whether a sheet of this size can be a pet of this version, and its rows --
 * or, in words a person can read, why not. Version 2 is exact. Version 1 is
 * what OpenPets never checked, so a Codex pet drawn at another scale still
 * reads: eight columns, nine rows, frames within 2% of 192:208, and no
 * smaller than half nor larger than twice the usual size.
 */
export function petRowsFor(size: PetSheetSize, version: 1 | 2): PetRows | string {
  if (size.animated) return 'Its sheet is an animation, not one still image.'
  if (!size.alpha) return 'Its sheet has no transparency, so it would be drawn on a box.'
  if (version === 2) {
    return size.width === PET_V2_WIDTH && size.height === PET_V2_HEIGHT
      ? 11
      : `Its sheet is ${String(size.width)} x ${String(size.height)}; a version 2 pet's is ${String(PET_V2_WIDTH)} x ${String(PET_V2_HEIGHT)}.`
  }
  if (size.width % PET_COLUMNS !== 0 || size.height % 9 !== 0) return 'Its sheet is not eight frames across and nine down.'
  const frameWidth = size.width / PET_COLUMNS
  const frameHeight = size.height / 9
  const aspect = frameWidth / frameHeight / (PET_FRAME_WIDTH / PET_FRAME_HEIGHT)
  if (aspect < 0.98 || aspect > 1.02) return 'Its frames are not the shape a pet is drawn in.'
  if (frameHeight < PET_FRAME_HEIGHT / 2 || frameHeight > PET_FRAME_HEIGHT * 2) return 'Its frames are too small or too large to be a pet.'
  return 9
}

/** What a pet can be doing, by the name of its sheet's row (OpenPets' own names). */
export type PetState = 'idle' | 'review' | 'running' | 'waving' | 'waiting' | 'jumping' | 'failed'

export interface PetRow {
  readonly row: number
  readonly frames: number
  /** One pass through the row. */
  readonly ms: number
  /** Played this many times, then it settles; absent: it loops. */
  readonly plays?: number
}

/**
 * OpenPets' `defaultPetSprite.states`, the rows a teammate uses: no running
 * left or right, since a teammate's face stays in its place. Waiting is
 * OpenPets' "Normal" (1010 ms).
 */
export const PET_ROWS: Readonly<Record<PetState, PetRow>> = {
  idle: { row: 0, frames: 6, ms: 5500 },
  waving: { row: 3, frames: 4, ms: 700, plays: 2 },
  jumping: { row: 4, frames: 5, ms: 840, plays: 2 },
  failed: { row: 5, frames: 8, ms: 1220, plays: 2 },
  waiting: { row: 6, frames: 6, ms: 1010 },
  running: { row: 7, frames: 6, ms: 820 },
  review: { row: 8, frames: 6, ms: 1030 }
}

/** A version 2 sheet's resting pose: row 0, column 6 (`codexV2SpriteLayout.neutralPose`). */
export const PET_NEUTRAL = { row: 0, column: 6 } as const

/**
 * A version 2 head turned toward one of 16 directions, 0 straight up and on
 * clockwise in 22.5-degree steps: 0-7 on row 9, 8-15 on row 10
 * (`getCodexV2GazeSpritePosition`). So right is 4, down 8, left 12.
 */
export function petGazeCell(index: number): { readonly row: number; readonly column: number } | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 15) return undefined
  return index < 8 ? { row: 9, column: index } : { row: 10, column: index - 8 }
}
