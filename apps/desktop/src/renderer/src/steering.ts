/**
 * Saying the next thing while a teammate is still working.
 *
 * Before this, the composer was simply disabled during a run: the only way to
 * add an instruction was to stop the work first. A queued message waits and
 * goes as the next turn of that conversation.
 *
 * The rule this file exists to state once, and test: a queued message is sent
 * only when the run it was typed at COMPLETED. A run that failed, was stopped
 * or was interrupted leaves it waiting with the reason on screen, because the
 * next instruction assumes the last turn happened -- the same rule a
 * routine's steps follow.
 */

export type QueuedVerdict =
  /** The run is still going; the message waits. */
  | { readonly kind: 'waiting' }
  /** Send it now, as the next turn. */
  | { readonly kind: 'send' }
  /** Held, with the reason a person needs to decide what to do. */
  | { readonly kind: 'held'; readonly note: string }

export function queuedVerdict(input: {
  /** Whether that run is still going. */
  readonly running: boolean
  /** How it ended, from the run's own state. Undefined when the run is gone. */
  readonly phase: string | undefined
  /** Whether the conversation it belongs to is the one on screen. */
  readonly onScreen: boolean
}): QueuedVerdict {
  if (input.phase === undefined) return { kind: 'held', note: 'held — that conversation is no longer open' }
  if (input.running) return { kind: 'waiting' }
  if (input.phase !== 'completed') {
    // The reason, not the button. A person who can see WHY it did not send
    // can decide what to do; "ready to send" only described the control and
    // was the one state nothing could be done about intelligently (design
    // pass, objection 1).
    return {
      kind: 'held',
      note: `held — the run ${
        input.phase === 'cancelled' ? 'was stopped' : input.phase === 'failed' ? 'failed' : 'did not finish'
      }`
    }
  }
  // Completed, but the person has moved to another conversation. Sending
  // would put the message into whatever is on screen now, which is not what
  // they were replying to.
  if (!input.onScreen) return { kind: 'held', note: 'typed in another conversation — sending puts it here instead' }
  return { kind: 'send' }
}

/**
 * Keep a queued message pointed at its conversation when the run is re-keyed.
 *
 * A mission is created under a temporary key and moved to the host's real
 * `runId` the moment the host answers -- and the temporary key is deleted in
 * the same breath. `shownKey` has always followed that move. The queue did
 * not, so a message typed in the window between pressing Enter and the host
 * answering pointed at a key that no longer existed, and the strip said
 * "held -- that conversation is no longer open" about a conversation that was
 * on screen. A first outside tester hit it by simply typing the next line
 * quickly (0.38.7 report, finding 13).
 *
 * The same move happens on a handoff, where the conversation continues under
 * a new runtime and `shownKey` follows it there too.
 */
export function requeuedTo<T extends { readonly key: string }>(
  queued: T | undefined,
  fromKey: string,
  toKey: string
): T | undefined {
  if (queued === undefined || queued.key !== fromKey) return queued
  return { ...queued, key: toKey }
}

/**
 * One queued row: what a person typed while a teammate was working.
 *
 * `origin` is the half grok-build gets right and this did not have at all.
 * A person's own follow-ups may be merged into one turn; anything the HOST
 * queued -- a routine's next step, a decision reply, a relay hand-off --
 * must go on its own, because merging it would put two different intents in
 * one instruction and attribute both to whoever typed last.
 */
export interface QueuedRow {
  readonly id: string
  /** The run it was typed at. Follows a re-key, as `requeuedTo` always has. */
  readonly key: string
  readonly text: string
  /** Whose intent this is. Only `person` rows merge. */
  readonly origin: 'person' | 'host'
  /** Attachments ride with the row. Only the FIRST of a merge may carry them. */
  readonly attachments?: readonly string[]
}

/** What separates two merged follow-ups in the text the runtime receives. */
export const QUEUE_SEPARATOR = '\n\n'

/**
 * Whether a row may open a merge run.
 *
 * grok-build's `can_merge_front`, with their gates and one of ours: a row
 * the host queued never merges. The front MAY carry attachments; a follower
 * may not, because there is no way to say which half of a merged instruction
 * an image belongs to.
 */
export function canMergeFront(row: QueuedRow): boolean {
  return row.origin === 'person' && row.text.trim().length > 0
}

/** `can_merge_follower`: the front's rules, plus no attachments. */
export function canMergeFollower(row: QueuedRow): boolean {
  return canMergeFront(row) && (row.attachments ?? []).length === 0
}

/**
 * Fold the leading run of mergeable rows into one.
 *
 * Three thoughts typed during one run are one instruction, not three turns --
 * which is the difference a person actually feels, because three turns means
 * the teammate answers the first, then the second, then the third, each
 * without knowing the others were coming.
 *
 * Only the LEADING run folds. A host row in the middle stops it and keeps its
 * place, so a routine step queued behind two follow-ups still runs after them
 * rather than being absorbed into them.
 */
export function combineQueued(rows: readonly QueuedRow[]): readonly QueuedRow[] {
  const front = rows[0]
  if (front === undefined || !canMergeFront(front)) return rows
  let taken = 1
  while (taken < rows.length) {
    const next = rows[taken]
    if (next === undefined || !canMergeFollower(next)) break
    taken += 1
  }
  if (taken === 1) return rows
  const merged: QueuedRow = {
    ...front,
    text: rows
      .slice(0, taken)
      .map((row) => row.text.trim())
      .join(QUEUE_SEPARATOR)
  }
  return [merged, ...rows.slice(taken)]
}

/**
 * The same re-key rule, for the whole queue.
 *
 * Kept beside `requeuedTo` rather than written at the call site, because the
 * rule it encodes -- a message follows its conversation when the host renames
 * the run under it -- is the one an outside tester hit in 0.38.7 by simply
 * typing the next line quickly.
 */
export function requeuedRows(
  rows: readonly QueuedRow[],
  fromKey: string,
  toKey: string
): readonly QueuedRow[] {
  return rows.map((row) => requeuedTo(row, fromKey, toKey) ?? row)
}
