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

export const QUEUE_RESTORED_NOTE = 'saved before Locust closed — press Send to continue'

export function queuedVerdict(input: {
  /** Whether that run is still going. */
  readonly running: boolean
  /** How it ended, from the run's own state. Undefined when the run is gone. */
  readonly phase: string | undefined
  /** Whether the conversation it belongs to is the one on screen. */
  readonly onScreen: boolean
  /** A relaunched queue needs a fresh Send, even if its run completed. */
  readonly restored?: boolean
  readonly held?: string
}): QueuedVerdict {
  if (input.held !== undefined) return { kind: 'held', note: input.held }
  if (input.restored) return { kind: 'held', note: QUEUE_RESTORED_NOTE }
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
  /** Recovered words are offered back, never scheduled automatically. */
  readonly restored?: boolean
  /** A refused dispatch waits for a fresh decision rather than retrying itself. */
  readonly held?: string
  readonly id: string
  /** The run it was typed at. Follows a re-key, as `requeuedTo` always has. */
  readonly key: string
  readonly text: string
  /** Whose intent this is. Only `person` rows merge. */
  readonly origin: 'person' | 'host'
  /** Attachments ride with the row. Only the FIRST of a merge may carry them. */
  readonly attachments?: readonly string[]
  /**
   * Not before this time (ms since the epoch): the host refused it as still
   * busy a moment ago. See `retriedAfterBusy`.
   */
  readonly retryAt?: number
  /** How many times the host has refused it as busy. */
  readonly tries?: number
  /**
   * M32: the run it waits behind, when that is not the conversation it was
   * typed in -- the teammate busy in ANOTHER conversation of theirs. The row
   * stays, shows and sends in `key`, its own conversation, once this run
   * has ended. It used to be keyed to that other run, vanished from where it
   * was typed when the run ended, and later sent into the wrong conversation.
   */
  readonly waitFor?: string
}

/**
 * A QUEUED MESSAGE THE HOST REFUSED AS BUSY GOES BACK IN LINE.
 *
 * It went because the run in front of it ended in this window, and the host
 * can still be finishing that run (drive-long-conversation on 0.297: turn 5
 * was refused and dropped). The host now takes the next turn of a run it is
 * winding down; anything else it refuses -- a turn on another runtime, a
 * teammate busy with something this window cannot see -- waits here instead
 * of vanishing, pointed at the conversation it was typed in, and is tried
 * again after half a second, then one, two, four, and every eight after that.
 */
export function retriedAfterBusy(row: QueuedRow, key: string, now: number): QueuedRow {
  const tries = (row.tries ?? 0) + 1
  return { ...row, key, tries, retryAt: now + Math.min(8_000, 250 * 2 ** tries) }
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
 *
 * And only rows typed in ONE conversation fold. The queue is every
 * conversation's, in the order things were typed, and this used to fold
 * across them: a line queued for Pip and one queued for Gem became one
 * instruction and went to whichever teammate's run was in front (outside
 * beta recheck of 0.299, P1). A row for another conversation stops the fold
 * the way a host row does.
 */
export function combineQueued(rows: readonly QueuedRow[]): readonly QueuedRow[] {
  const front = rows[0]
  if (front === undefined || !canMergeFront(front)) return rows
  let taken = 1
  while (taken < rows.length) {
    const next = rows[taken]
    if (next === undefined || next.key !== front.key || next.restored !== front.restored || next.held !== front.held || !canMergeFollower(next)) break
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
 * WHAT IS WAITING IN ONE CONVERSATION.
 *
 * The queue holds every conversation's rows in the order they were typed,
 * and the box under a conversation is about that conversation alone: it
 * shows, edits, discards and sends its own rows and nobody else's. It used
 * to show the queue's first row wherever you were -- a line queued for Pip
 * sat under Gem's thread reading "sends when Gem finishes", and Edit there
 * rewrote Pip's (outside beta recheck of 0.299, P1).
 */
/**
 * M32: WHERE A MESSAGE TYPED NOW WAITS, AND WHAT IT WAITS FOR. The live run
 * on screen is the conversation replied into. Otherwise, with the addressed
 * teammate busy elsewhere: in the conversation on screen if it is theirs,
 * waiting for the busy run; into the busy run if the thread on screen is not
 * theirs (or there is none). With nobody busy, the conversation on screen.
 */
export function queueHome(input: {
  readonly liveOnScreen: string | undefined
  readonly busyKey: string | undefined
  readonly shownKey: string | undefined
  readonly shownIsTheirs: boolean
}): { readonly queueKey: string | undefined; readonly waitForKey: string | undefined } {
  const { liveOnScreen, busyKey, shownKey, shownIsTheirs } = input
  const queueKey = liveOnScreen ?? (busyKey !== undefined && !shownIsTheirs ? busyKey : shownKey ?? busyKey)
  const waitForKey = liveOnScreen === undefined && busyKey !== undefined && queueKey !== busyKey ? busyKey : undefined
  return { queueKey, waitForKey }
}

export function queuedIn(rows: readonly QueuedRow[], key: string | undefined): readonly QueuedRow[] {
  return key === undefined ? [] : rows.filter((row) => row.key === key)
}

/**
 * The next message one conversation sends -- its own rows folded -- and the
 * queue without what went. Every other conversation's rows stay as they were,
 * in place.
 */
export function takeNext(
  rows: readonly QueuedRow[],
  key: string
): { readonly going: QueuedRow | undefined; readonly rest: readonly QueuedRow[] } {
  const own = queuedIn(rows, key)
  const folded = combineQueued(own)
  const going = folded[0]
  if (going === undefined) return { going: undefined, rest: rows }
  // The rows that went: the front and every follower folded into it. By the
  // row itself, not its id -- two rows can be given the same id.
  const went = new Set(own.slice(0, own.length - (folded.length - 1)))
  return { going, rest: rows.filter((row) => !went.has(row)) }
}

/** A conversation's queue, gone: Discard, or Edit taking the words back into the box. */
export function withoutQueueOf(rows: readonly QueuedRow[], key: string | undefined): readonly QueuedRow[] {
  return key === undefined ? rows : rows.filter((row) => row.key !== key)
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
