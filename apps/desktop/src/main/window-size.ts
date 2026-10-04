/** The smallest the layout is designed to work at. */
export const MIN_WINDOW_WIDTH = 1120
export const MIN_WINDOW_HEIGHT = 720

/**
 * The smallest the window may be on a work area of this size: the layout's
 * minimum, unless the work area itself is smaller -- then the work area, so
 * the window fits and the layout scrolls. M21 (the code review): 1920x1080
 * at 150%, Windows' default on most 1080p laptops, leaves a 672-tall work
 * area; a 720 minimum put the composer's bottom row behind the taskbar, and
 * the window could not be made small enough to bring it out.
 */
export function minimumSize(work: { readonly width: number; readonly height: number }): {
  readonly width: number
  readonly height: number
} {
  return {
    width: Math.min(MIN_WINDOW_WIDTH, Math.max(1, Math.floor(work.width))),
    height: Math.min(MIN_WINDOW_HEIGHT, Math.max(1, Math.floor(work.height)))
  }
}

/**
 * How big the window opens.
 *
 * It was a flat 1480x940, which is most of a laptop screen and reads as "very
 * large" the moment it appears -- Colin, 2026-09-04, asking for something
 * closer to the size an editor opens at. A fixed number cannot be right on
 * every display, so this takes a comfortable fraction of the work area and
 * caps it, never going below the minimums the layout needs.
 *
 * Deliberately its own module: `index.ts` starts the whole host when it is
 * imported, so a test that wanted this would have had to boot Electron.
 */
export function openingSize(work: { readonly width: number; readonly height: number }): {
  readonly width: number
  readonly height: number
} {
  const floor = minimumSize(work)
  return {
    /*
     * 1215 WIDE, which is the width Colin actually works at.
     *
     * 2026-09-21: *"make default size on open what mine usually is, i think
     * its 1215x708 so new users dont see all that dead horizontal space at
     * full screen"*. The cap was 1280 and the fraction 0.82, so on a wide
     * display a new person met a window with a column of empty panel beside
     * the thread -- the app looking like it had nothing to put there.
     *
     * The fraction stays, because a fixed number cannot be right on every
     * display; only the ceiling moves.
     */
    width: Math.max(floor.width, Math.min(1215, Math.round(work.width * 0.82))),
    /*
     * 800, not the 708 he named, and the difference is worth saying out loud:
     * `MIN_WINDOW_HEIGHT` is 720, so 708 is below the height this layout is
     * built to work at. His number is almost certainly CSS pixels read at
     * display scaling rather than the window's own size.
     *
     * So the ceiling comes down from 860 to 800 -- the honest part of the ask
     * -- and going lower is a real decision about the minimum, not a default.
     */
    height: Math.max(floor.height, Math.min(800, Math.round(work.height * 0.86)))
  }
}
