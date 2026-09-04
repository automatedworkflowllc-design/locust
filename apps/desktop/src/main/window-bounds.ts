import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, openingSize } from './window-size.js'

/**
 * Where the window opens, remembered between launches.
 *
 * `openingSize` picks a good FIRST size; it has no opinion about the second
 * launch, so every launch reset the window to the middle of the screen at the
 * same size. Colin asked for something closer to how an editor behaves --
 * where you size the window once and it stays sized.
 *
 * The decision is pure and lives here rather than in `index.ts` so it can be
 * tested against a saved file and a set of displays without booting Electron.
 * The interesting cases are not the happy path: a saved position points at a
 * monitor that is no longer plugged in, or a file someone hand-edited.
 */

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SavedWindow extends Rect {
  /** Maximized windows restore maximized, but keep the size to un-maximize to. */
  readonly maximized: boolean
}

export interface OpeningPlacement {
  readonly width: number
  readonly height: number
  /** Undefined means "no remembered position" -- the caller centers instead. */
  readonly x: number | undefined
  readonly y: number | undefined
  readonly maximized: boolean
}

/**
 * How much of the window has to land on a display for the position to be
 * usable. A window restored onto an unplugged monitor is not a small
 * inconvenience -- it is invisible, with no way to drag it back, and the app
 * looks like it failed to start. A titlebar's worth of window is the least
 * that leaves something to grab.
 */
const MIN_VISIBLE_WIDTH = 160
const MIN_VISIBLE_HEIGHT = 48

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * The file is in the user's profile where anything can edit it, so it is read
 * as untrusted: a record that is not fully a rectangle is no record at all.
 */
export function readSavedWindow(value: unknown): SavedWindow | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const { x, y, width, height } = record
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return undefined
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return undefined
  if (width <= 0 || height <= 0) return undefined
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: record.maximized === true
  }
}

const overlaps = (window: Rect, display: Rect): boolean => {
  const width = Math.min(window.x + window.width, display.x + display.width) - Math.max(window.x, display.x)
  const height = Math.min(window.y + window.height, display.y + display.height) - Math.max(window.y, display.y)
  return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT
}

/**
 * What to open with, given whatever was saved and the displays that exist now.
 *
 * A saved size is honoured even when it is larger than the default opening
 * size -- that is the whole point -- but never smaller than the layout needs,
 * and never taller or wider than the display it lands on.
 */
export function openingPlacement(
  saved: SavedWindow | undefined,
  displays: readonly Rect[],
  primaryWork: { readonly width: number; readonly height: number }
): OpeningPlacement {
  const fallback = openingSize(primaryWork)
  if (!saved) {
    return { width: fallback.width, height: fallback.height, x: undefined, y: undefined, maximized: false }
  }

  const home = displays.find((display) => overlaps(saved, display))
  const bound = home ?? { x: 0, y: 0, width: primaryWork.width, height: primaryWork.height }
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(saved.width, bound.width))
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(saved.height, bound.height))

  // No display owns the saved position: the monitor it was on is gone. Keep
  // the size the person chose and let the caller center it, rather than
  // opening off the edge of every screen.
  if (!home) {
    return { width, height, x: undefined, y: undefined, maximized: saved.maximized }
  }

  return { width, height, x: saved.x, y: saved.y, maximized: saved.maximized }
}
