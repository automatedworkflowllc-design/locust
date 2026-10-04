/**
 * M31 (the code review): AN APPROVAL CARD GOES WITH ITS RUN.
 *
 * A card left the window's list only when it was answered, withdrawn
 * (Antigravity alone sends that) or handed off. When a Codex or Claude run
 * ended or was stopped with a card open, the host refused the request
 * silently and the card stayed -- live-looking buttons that did nothing, and
 * the teammate reading "waiting on you" for the rest of the session.
 *
 * So a card whose run has ENDED is dropped. A card whose run the window does
 * not know yet is kept: it may have arrived before the run's own receipt.
 */
export interface RunLike {
  readonly phase: string
  readonly data?: { readonly runId?: string }
}

const ENDED = new Set(['completed', 'failed', 'cancelled'])

export function approvalsOfLiveRuns<T extends { readonly runId: string }>(
  approvals: readonly T[],
  runs: ReadonlyMap<string, RunLike>
): readonly T[] {
  const kept = approvals.filter((approval) => {
    const run = runs.get(approval.runId) ?? [...runs.values()].find((entry) => entry.data?.runId === approval.runId)
    return run === undefined || !ENDED.has(run.phase)
  })
  return kept.length === approvals.length ? approvals : kept
}
