import type { ReactElement } from 'react'

import type { CancellationSummary } from '../missionView.js'

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
  stoppedAt
}: {
  readonly summary: CancellationSummary
  readonly stoppedAt: string | undefined
}): ReactElement {
  const nothingHappened =
    summary.settled.length === 0 && summary.interrupted.length === 0 && summary.neverStarted === 0

  // Standing, not amber: this reports a run that already stopped and asks for
  // nothing. Amber is reserved for a card that holds a control.
  return (
    <div className="lc-card is-standing">
      <div className="lc-card__head">
        <span className="lc-approval__title">
          You stopped this run{stoppedAt === undefined ? '' : ` at ${stoppedAt}`}
        </span>
        <span className="lc-tag is-amber">Stopped</span>
      </div>

      {nothingHappened ? (
        <div className="lc-card__body">
          Nothing had started yet, so nothing was left half-done.
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
              'Nothing was mid-flight.'
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

      <p className="lc-approval__note">
        Everything up to this point is in the durable record. Nothing is rolled back — this build
        does not snapshot the workspace, so undoing a change is yours to do.
      </p>
    </div>
  )
}
