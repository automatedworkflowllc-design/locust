/**
 * A quit that always ends.
 *
 * Closing Locust waits for every live run to settle, and one of those waits
 * is a promise that only resolves when a runtime's child process closes its
 * output. A runtime that ignores the kill -- a detached Claude Code or Codex
 * tree on Windows -- therefore leaves the app with no window, a process still
 * resident, and no way out. Nothing on screen; nothing in the task bar; the
 * process manager is the only place it still exists.
 *
 * That is bad on its own and worse on the folder switch, which quits in order
 * to REOPEN. `app.relaunch()` hands a helper process the parent's handle and
 * the helper starts Locust again when the parent dies, so a parent that never
 * dies is a Locust that closed and never came back. Colin, 2026-09-09:
 * "switching work folder resets and closes the entire app."
 *
 * So the wait is bounded. `leave` is called exactly once -- with `finished`
 * when the work completed, `deadline` when it did not -- and a flush that
 * lands a moment after the deadline can no longer quit an app that has
 * already been told to go.
 */
export function boundedShutdown(options: {
  /** Everything that must reach disk before the app may go. */
  readonly work: () => Promise<void>
  /**
   * How long that is allowed to take.
   *
   * Long enough for the ordinary flush, which is measured in well under a
   * second, and short enough that a person does not read the wait as the app
   * already being gone.
   */
  readonly deadlineMs: number
  /** Called exactly once, whichever came first. */
  readonly leave: (reason: 'finished' | 'deadline') => void
  /** The work threw. Neither `leave` nor the deadline follows this. */
  readonly failed: (error: unknown) => void
}): void {
  let left = false
  const timer = setTimeout(() => {
    if (left) return
    left = true
    options.leave('deadline')
  }, options.deadlineMs)
  // A pending deadline must never hold the process open by itself: the point
  // of the timer is to let go, not to become one more thing being waited on.
  if (typeof timer.unref === 'function') timer.unref()
  void options
    .work()
    .then(() => {
      if (left) return
      left = true
      clearTimeout(timer)
      options.leave('finished')
    })
    .catch((error: unknown) => {
      if (left) return
      left = true
      clearTimeout(timer)
      options.failed(error)
    })
}
