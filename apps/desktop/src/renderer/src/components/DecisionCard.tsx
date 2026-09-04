import type { ReactElement } from 'react'

import type { DecisionOption, DecisionRequest } from '../../../shared/decision.js'
import { Icon } from './Icon.js'

/**
 * A teammate asking which way to go.
 *
 * Deliberately not the approval card, and it must not be mistaken for one.
 * An approval asks *may I do this thing I am about to do* and wears amber,
 * because something is pending against the workspace. This asks *which of
 * these should I do* -- the run has ENDED, nothing is pending, nothing is
 * being held. So it is neutral, and it never wears the colour that means
 * "stopped" or the colour that means "waiting to act".
 *
 * What each choice costs comes from the runtime and is shown as its words,
 * never as a recommendation. The card does not mark one option as preferred:
 * the whole reason it exists is that the model reached a fork it should not
 * resolve on its own, and quietly nominating a favourite would resolve it.
 */
export function DecisionCard({
  request,
  teammateName,
  standing,
  onChoose,
  busy
}: {
  readonly request: DecisionRequest
  /** Whose question it is. Undefined when the mission has no teammate. */
  readonly teammateName: string | undefined
  /**
   * What may honestly be said about the workspace, derived by
   * `decisionStanding` rather than written here. The design's "nothing
   * changed" is a claim, and only a read-only run can make it.
   */
  readonly standing: string
  readonly onChoose: (option: DecisionOption) => void
  readonly busy: boolean
}): ReactElement {
  const who = teammateName ?? 'The runtime'
  return (
    <div className="lc-decision" role="group" aria-label="A decision is needed to continue">
      <div className="lc-decision__head">
        <span className="lc-decision__title">
          <Icon name="diff" size={13} /> {who} needs a decision to continue
        </span>
        <span className="lc-rail__meta">{standing}</span>
      </div>
      <p className="lc-decision__question">{request.question}</p>
      <div className="lc-decision__options">
        {request.options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="lc-decision__option"
            disabled={busy}
            onClick={() => onChoose(option)}
          >
            <span className="lc-decision__label">{option.label}</span>
            {option.note !== undefined && <span className="lc-decision__note">{option.note}</span>}
          </button>
        ))}
      </div>
      {/*
        Said plainly, because a card with buttons reads as though those are the
        only ways forward. They are not: the composer is right there, and an
        answer nobody offered is often the right one.
      */}
      <div className="lc-decision__foot lc-mono">
        Or reply below — you are not limited to these
      </div>
    </div>
  )
}
