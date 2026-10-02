import type { ReactElement } from 'react'

import type { CancellationSummary } from '../missionView.js'

/** No tool call settled, none was cut off, none was planned: what "nothing happened" means on this card. */
export function stoppedBeforeAnyTool(summary: CancellationSummary): boolean {
  return summary.settled.length === 0 && summary.interrupted.length === 0 && summary.neverStarted === 0
}

/**
 * What a stopped run actually left behind.
 *
 * The design offers KEPT / STOPPED / NOT DONE and a "Revert to checkpoint"
 * button. The first three are derivable from the event stream; the revert is
 * not, because nothing in this product snapshots a workspace, so it is absent
 * rather than present-and-broken.
 *
 * "Kept" is deliberately worded as what the runtime REPORTED finishing. The
 * host does not track file-level effects, and a card that said "these edits are
 * safe on disk" would be claiming knowledge it does not have.
 */
export function CancellationCard({
  summary,
  stoppedAt,
  byPerson = true
}: {
  readonly summary: CancellationSummary
  readonly stoppedAt: string | undefined
  /**
   * Whether the person pressed Stop. A teammate's message can stop a run too
   * (the relay's interrupt), and a reopened conversation cannot say who did,
   * so only a press seen in this window reads "You stopped" (code review B4,
   * renderer-thread (f)).
   */
  readonly byPerson?: boolean
}): ReactElement {
  const nothingHappened = stoppedBeforeAnyTool(summary)

  // Standing, not amber: this reports a run that already stopped and asks for
  // nothing. Amber is reserved for a card that holds a control.
  return (
    <div className="lc-card is-standing">
      <div className="lc-card__head">
        <span className="lc-approval__title">
          {byPerson ? 'You stopped this run' : 'This run was stopped'}{stoppedAt === undefined ? '' : ` at ${stoppedAt}`}
        </span>
        <span className="lc-tag is-amber">Stopped</span>
      </div>

      {nothingHappened ? (
        /*
         * Said as what the RUN did, not as a denial of what the person did.
         *
         * Sol's beta review, 2026-09-21, finding 4: the card read *"You
         * stopped this run at 05:08 PM"* and, directly under it, *"Nothing
         * had started yet."* Both are true of different subjects -- the stop
         * happened, no tool call had opened -- and stacked like that the
         * second reads as taking back the first. Sol: *"If the person
         * pressed Stop, do not also say nothing had started."*
         *
         * The fact this reports is unchanged; only who the sentence is about
         * changes. `nothingHappened` is still exactly "no tool call settled,
         * none was interrupted, none was planned", which is what "any work"
         * means on this card.
         *
         * "Any TOOLS", not "any work" (0.420): a stopped Claude Haiku had
         * written the numbers 1 to 191 into the thread above this card, and
         * "before it did any work" sat under them (fresh-eyes area 17). The
         * condition is about tool calls, so the sentence names tool calls.
         */
        <div className="lc-card__body">
          {summary.toolsReportedWhenDone === true
            ? 'Stopped before it reported using any tools. OpenCode reports a tool only once it finishes, so a command it had started may still have run.'
            : 'Stopped before it used any tools, so nothing is half-done.'}
        </div>
      ) : (
        <dl className="lc-receipt">
          <dt>Finished</dt>
          <dd>
            {summary.settled.length === 0 ? (
              'Nothing reported finishing.'
            ) : (
              <ul className="lc-cancel__list">
                {summary.settled.map((name, index) => (
                  <li key={`${name}-${index}`} className="lc-mono">
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </dd>

          <dt>Cut off</dt>
          <dd className={summary.interrupted.length > 0 ? 'lc-tone-amber' : undefined}>
            {summary.interrupted.length === 0 ? (
              /*
               * What this actually knows, said as what it knows.
               *
               * It said "Nothing was mid-flight." -- a claim about the
               * MACHINE, from a list that only holds tool calls the runtime
               * had reported as open. Astra measured the gap on 2026-09-14:
               * a stopped run showed this sentence while the command it had
               * launched was still running, and ninety seconds later that
               * command wrote its second file into the workspace. The card
               * said nothing was in flight; something was.
               *
               * The list is right and the sentence was wrong, so only the
               * sentence changes. What a stop cannot promise is said below,
               * beside the note about nothing being rolled back.
               */
              summary.toolsReportedWhenDone === true
                ? 'None reported. OpenCode reports a tool only once it finishes, so a command it had started may still have run.'
                : 'No tool call was open when you stopped it.'
            ) : (
              <>
                <ul className="lc-cancel__list">
                  {summary.interrupted.map((name, index) => (
                    <li key={`${name}-${index}`} className="lc-mono">
                      {name}
                    </li>
                  ))}
                </ul>
                {/*
                  This is the honest half of a cancellation: an action that
                  started and never reported back may or may not have taken
                  effect, and only the person can find out.
                */}
                <span className="lc-cancel__note">
                  Started and never reported back — whether it took effect is unknown.
                </span>
              </>
            )}
          </dd>

          {summary.neverStarted > 0 && (
            <>
              <dt>Never started</dt>
              <dd>
                {summary.neverStarted} planned step{summary.neverStarted === 1 ? '' : 's'}
              </dd>
            </>
          )}
        </dl>
      )}

      {/*
        * Not on a run stopped before any tool (0.496): "undoing a change is
        * yours to do" under "nothing is half-done" names changes that were
        * never made, on the card a double-clicked Send leaves most often.
        */}
      {!nothingHappened && (
        <p className="lc-approval__note">
          Everything up to this point is in the durable record. Nothing is rolled back — this build
          does not snapshot the workspace, so undoing a change is yours to do.
        </p>
      )}
      {/*
        * The one thing a stop cannot promise, said once rather than implied
        * by silence. MEASURED 2026-09-14: a stopped run's own command kept
        * running and wrote a file into the workspace ninety seconds later.
        * Until that is fixed at the process level, a person reading this card
        * has to be told it can happen — a stop that is quietly partial is the
        * worst version of this feature.
        *
        * NOT on a run where nothing started. Grok's beta drive, 2026-09-14,
        * finding 4: one card said "Nothing had started yet, so nothing was
        * left half-done" and then, in amber underneath, that a command which
        * had already started may still be running. Two sentences on one card
        * that cannot both be the situation, and the ledger settled which: a
        * create and a `run.cancelled` eight milliseconds later, zero records.
        *
        * A warning that is false here does not buy safety, it spends the
        * reader's trust in the one warning on this card that is real.
        */}
      {!nothingHappened && (
        <p className="lc-approval__note lc-tone-amber">
          A command that had already started may still finish on its own. If one was running, check the
          workspace rather than assuming it stopped when you did.
        </p>
      )}
    </div>
  )
}
