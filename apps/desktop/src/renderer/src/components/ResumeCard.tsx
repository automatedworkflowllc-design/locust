import type { ReactElement } from 'react'

import type { ResumeOffer } from '../resume.js'
import { startedLabel } from '../missionView.js'
import { Icon } from './Icon.js'

/**
 * Picking up a mission the app stopped in the middle of.
 *
 * The ledger has written checkpoints since the beginning and the receipt has
 * reported them; what never existed was the affordance, so an interrupted
 * mission was a dead record you could read.
 *
 * Three states, and they are deliberately different cards rather than one card
 * with a disabled button. A refusal is not a resume you cannot click yet -- it
 * is the app saying it will not vouch for the record, which is information,
 * and a greyed-out button says that far more quietly than it deserves.
 */
export function ResumeCard({
  offer,
  onResume,
  busy,
  refusal
}: {
  readonly offer: ResumeOffer | undefined
  readonly onResume: (epoch: number) => void
  readonly busy: boolean
  /** M28: why the last press did not resume it, in the host's words. */
  readonly refusal?: string
}): ReactElement | null {
  if (offer === undefined) return null

  if (offer.kind === 'refused') {
    // Standing, not amber and not red. Nothing failed -- the mission stopped
    // and the app is declining to guess, which is the behaviour. And nothing
    // is being asked: this branch has no button, so wearing the colour that
    // means "waiting for you" made it compete with cards that were.
    return (
      <div className="lc-card is-standing" role="group" aria-label="This mission cannot be resumed">
        <div className="lc-card__head">
          <span>Cannot be resumed from here</span>
        </div>
        <div className="lc-card__body">{offer.note}</div>
      </div>
    )
  }

  const doubted = offer.kind === 'resume-with-doubt'
  return (
    <div className="lc-resume" role="group" aria-label="Resume this mission">
      <div className="lc-resume__head">
        <span className="lc-resume__title">
          <Icon name="diff" size={13} /> Interrupted — the last checkpoint was kept
        </span>
        <span className="lc-rail__meta">
          {startedLabel(offer.at) ?? 'time not recorded'} · checkpoint {offer.epoch}
        </span>
      </div>
      <p className="lc-resume__note">{offer.note}</p>
      {doubted && (
        // Named, not counted. A person can go and look at these before saying
        // go, which is the entire reason the outcome being unknown is worth
        // telling them about.
        <ul className="lc-resume__unverified">
          {offer.unverified.map((name, index) => (
            <li key={`${name}_${String(index)}`} className="lc-mono">
              {name}
            </li>
          ))}
        </ul>
      )}
      <div className="lc-resume__actions">
        <button type="button" className="lc-button" disabled={busy} onClick={() => onResume(offer.epoch)}>
          <Icon name="diff" size={13} /> {doubted ? 'Resume anyway' : 'Resume from checkpoint'}
        </button>
        {doubted && (
          <span className="lc-resume__caution">
            Check those first — the next run is told to verify them before building on them.
          </span>
        )}
      </div>
      {refusal !== undefined && (
        <p className="lc-resume__refusal" role="alert">
          Not resumed: {refusal}
        </p>
      )}
    </div>
  )
}
