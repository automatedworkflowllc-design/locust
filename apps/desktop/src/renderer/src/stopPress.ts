/**
 * What pressing Stop means, given the run that is on screen.
 *
 * There are three answers and the middle one is the one that was missing.
 *
 * A run is `starting` from the moment a person presses send until the host
 * answers with its run id, and the composer draws the stop button for the
 * whole of that -- rightly, because the runtime is already going and the
 * person can see it going. But there was nothing to cancel BY: the press read
 * the run id off the shown run, found none, and returned without a word.
 *
 * MEASURED 2026-09-10 on the second turn of a conversation: `shownKey` was
 * still `pending:2` six seconds after send, so the press did nothing at all
 * and the mission ran to completion -- 200 of 200 numbers. Controlled on both
 * Claude Code and Codex CLI, which is how it was told apart from the
 * transport change made the same day. A first turn resolves fast enough to
 * hide it, which is why every earlier drive of the stop button passed.
 *
 * So a press against a starting run is REMEMBERED rather than dropped, and
 * the start honours it as soon as the run can be named.
 */

export type StopPress =
  /** Nothing is running, or the press has already been answered. */
  | { readonly kind: 'nothing' }
  /** The ordinary case: the run has a name, so it can be cancelled now. */
  | { readonly kind: 'cancel'; readonly runId: string }
  /** Still starting: remember it against the key it has, and cancel on arrival. */
  | { readonly kind: 'cancel-when-named'; readonly key: string }

export interface StoppableRun {
  readonly phase: string
  readonly data?: { readonly runId: string } | undefined
}

/** The phases in which a mission is the person's to stop. */
export function isStoppable(phase: string | undefined): boolean {
  return phase === 'starting' || phase === 'running' || phase === 'cancelling'
}

export function stopPress(
  run: StoppableRun | undefined,
  shownKey: string | undefined
): StopPress {
  if (run === undefined || !isStoppable(run.phase)) return { kind: 'nothing' }
  const runId = run.data?.runId
  if (runId !== undefined) return { kind: 'cancel', runId }
  // No id yet. The key the run is filed under is the only handle there is,
  // and without one there is nothing to remember the press against.
  if (shownKey === undefined) return { kind: 'nothing' }
  return { kind: 'cancel-when-named', key: shownKey }
}
