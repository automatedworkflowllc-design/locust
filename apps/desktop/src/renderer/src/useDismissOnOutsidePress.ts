import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Close an open panel when the person presses anywhere else, or on Escape.
 *
 * Reported by the first outside tester on 0.55.0: "for selecting the effort
 * level and model, you to click out of it you have to click the button again
 * instead of just clicking anywhere on the page." Three panels in the
 * composer -- the permission mode menu, the effort panel and the route
 * picker -- opened on a click and closed only by pressing the same control
 * again, choosing something, or (for the picker) Escape.
 *
 * That is not how a menu behaves anywhere else in this app: `ContextMenu`
 * and `RailFlyout` have both closed on an outside press since they were
 * written, and this is the same handler they use. Nor anywhere else on the
 * machine, which is the actual complaint -- a person does not learn a menu,
 * they expect one.
 *
 * The press is caught in the CAPTURE phase, as `ContextMenu` does, so it
 * closes before the press does its own work; without that, clicking the
 * button that opened it would close and immediately reopen. That is why the
 * trigger is passed in too: a press on it is left alone, so the button keeps
 * toggling the way it always did.
 *
 * A scroll closes it when the panel moved with it -- see `onScroll`: a
 * scroll of some other part of the window leaves it where it is.
 */
export function useDismissOnOutsidePress(
  open: boolean,
  onClose: () => void,
  ...ignore: readonly RefObject<HTMLElement | null>[]
): void {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPress = (event: MouseEvent): void => {
      const target = event.target
      // A press on the panel itself, or on the control that opens it, is
      // that panel's business.
      if (target instanceof Node && ignore.some((ref) => ref.current?.contains(target) === true)) return
      onClose()
    }
    /*
     * H11 (the code review): a scroll closes it only when what scrolled
     * CARRIES the panel -- the page, or an element the panel sits inside --
     * because only then has the panel moved out from under what it points
     * at. It closed on every scroll anywhere, and the thread scrolls itself
     * each frame while it follows a streaming reply: the route picker opened
     * mid-run to hand off, the effort panel, and every right-click menu
     * closed on their own while a teammate answered.
     */
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target === document || target === document.documentElement || target === document.body) {
        onClose()
        return
      }
      if (!(target instanceof Node)) return
      // Scrolling inside the panel itself is the panel's business.
      if (ignore.some((ref) => ref.current?.contains(target) === true)) return
      if (ignore.some((ref) => ref.current !== null && ref.current !== undefined && target.contains(ref.current))) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPress, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPress, true)
      window.removeEventListener('scroll', onScroll, true)
    }
    // `ignore` is a fresh array each render; its refs are stable, and the
    // effect only reads `.current`, so the refs themselves are the dependency
    // that matters and they never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])
}
