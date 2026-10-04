/**
 * WHETHER LOCUST'S WINDOW IS IN FRONT (0.611).
 *
 * A window behind other windows is still painted: its animation frames keep
 * coming and its CSS animations keep running, so Locust kept drawing for
 * nobody. Colin's Task Manager, 2026-10-04, with Locust behind it while
 * Sonnet's executor ran in it for 99 minutes: Locust's GPU process about 27 %
 * of a 12-core machine and its renderer 15 %. Measured on the built app
 * (probe-faces-rest-behind.mjs), a free-model answer streaming cost 13 % in
 * front and the same behind other windows; with every face and animation
 * held while it is behind, 3 %.
 *
 * So while the window is behind others or hidden, every face's clock asks
 * for no frames (Bot's startBotClock) and the stylesheet holds every CSS
 * animation (`:root[data-away]` in shell.css). What a run says still
 * arrives -- its text, its steps, its counts -- and everything moves again
 * the moment the window is in front. The cover already rested so (0.305);
 * this is the same rule for the rest of the app.
 */
export interface WindowPresence {
  /** True while the window is behind other windows, or hidden. */
  readonly away: () => boolean
  /** Calls `changed` whenever that may have changed; returns the way to stop. */
  readonly watch: (changed: () => void) => () => void
}

let away: boolean | undefined
const watchers = new Set<() => void>()

/** The attribute the stylesheet holds every animation by, on the root element. */
export const AWAY_ATTRIBUTE = 'data-away'

/**
 * One set of listeners for the whole window, made the first time anything
 * asks; main.tsx asks at start, so the stylesheet's hold works with no face
 * on screen. Reads the window as it is now, as the cover does: a focus that
 * landed before these listeners is missed by them.
 */
export function watchWindowPresence(): void {
  if (away !== undefined || typeof window === 'undefined' || typeof document === 'undefined') return
  // The loading window is never held: its motion is what says Locust is starting, focused or not.
  if (window.location?.hash === '#splash') {
    away = false
    return
  }
  const hidden = (): boolean => document.visibilityState === 'hidden'
  const mark = (): void => {
    document.documentElement?.toggleAttribute(AWAY_ATTRIBUTE, away === true)
  }
  away = hidden() || !document.hasFocus()
  mark()
  const set = (next: boolean): void => {
    if (next === away) return
    away = next
    mark()
    for (const changed of [...watchers]) changed()
  }
  window.addEventListener('focus', () => set(hidden()))
  window.addEventListener('blur', () => set(true))
  document.addEventListener('visibilitychange', () => set(hidden() || !document.hasFocus()))
}

/** The window's own: in front unless it is behind others or hidden; always in front where there is no window. */
export const WINDOW_PRESENCE: WindowPresence = {
  away: () => {
    watchWindowPresence()
    return away ?? false
  },
  watch: (changed) => {
    watchWindowPresence()
    watchers.add(changed)
    return () => {
      watchers.delete(changed)
    }
  }
}
