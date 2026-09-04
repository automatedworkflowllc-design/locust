/** The smallest the layout is designed to work at. */
export const MIN_WINDOW_WIDTH = 1120
export const MIN_WINDOW_HEIGHT = 720

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
  return {
    width: Math.max(MIN_WINDOW_WIDTH, Math.min(1280, Math.round(work.width * 0.82))),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.min(860, Math.round(work.height * 0.86)))
  }
}
