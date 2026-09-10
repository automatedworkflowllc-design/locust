/**
 * Deltas land once per frame, not once per token.
 *
 * Colin, 2026-09-10: "compared to claude code and codex, the text seems to
 * come out rather aggressively or glitchy."
 *
 * Half of that is cadence. A streaming reply arrives as `message.delta`
 * events, each one its own IPC message and therefore its own task -- React
 * batches state updates within a task, not across them, so every delta was a
 * full re-render of the thread. Deltas arrive in bursts (several in one
 * tick, then a pause), so the text lurched rather than flowed.
 *
 * Claude Code's own renderer never paints per token: it coalesces, and the
 * visible text advances on a steady cadence. This is that. Held updates are
 * committed together on the next animation frame, in the order they came.
 *
 * Only DELTAS are held. Anything else -- a run finishing, failing, a tool
 * starting -- flushes at once, with whatever deltas were waiting ahead of it,
 * so order is never changed and a terminal event is never a frame late.
 */

export interface FrameBatcher<T> {
  /** Hold one item for the next frame, or flush now when `urgent`. */
  push(item: T, urgent?: boolean): void
  /** Commit whatever is held. Idempotent. */
  flush(): void
  /** Drop the pending frame. Held items are flushed first, never lost. */
  dispose(): void
}

/** `requestAnimationFrame` where there is a window, a short timer where there is not. */
const scheduleFrame: (callback: () => void) => () => void =
  typeof requestAnimationFrame === 'function'
    ? (callback) => {
        const handle = requestAnimationFrame(callback)
        return () => cancelAnimationFrame(handle)
      }
    : (callback) => {
        const handle = setTimeout(callback, 16)
        return () => clearTimeout(handle)
      }

export function createFrameBatcher<T>(
  commit: (items: readonly T[]) => void,
  schedule: (callback: () => void) => () => void = scheduleFrame
): FrameBatcher<T> {
  let held: T[] = []
  let cancel: (() => void) | undefined

  const flush = (): void => {
    if (cancel !== undefined) {
      cancel()
      cancel = undefined
    }
    if (held.length === 0) return
    const items = held
    held = []
    commit(items)
  }

  return {
    push(item, urgent = false) {
      held.push(item)
      if (urgent) {
        flush()
        return
      }
      cancel ??= schedule(() => {
        cancel = undefined
        flush()
      })
    },
    flush,
    dispose() {
      flush()
    }
  }
}
