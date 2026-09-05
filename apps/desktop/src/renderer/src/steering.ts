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
