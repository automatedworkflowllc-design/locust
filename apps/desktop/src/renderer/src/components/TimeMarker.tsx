import type { ReactElement } from 'react'

import { clockTime } from '../missionView.js'

/**
 * A hairline with the time on it. It separates completed work from what is
 * happening now, and marks any silence longer than two minutes between
 * turns, so a long mission reads as a timeline rather than a wall. Lighter
 * than the `MISSION · id` rule above it, so the two read as different levels.
 */
export function TimeMarker({
  at,
  minutesIn,
  elapsed,
  day,
  note
}: {
  readonly at: string
  readonly minutesIn: number
  /**
   * How far in, in units a person thinks in. This used to be written here
   * as `{minutesIn} min in`, which produced `959 min in` on a conversation
   * that had been going since the previous day (Colin, 2026-09-21). See
   * `elapsedInLabel`.
   */
  readonly elapsed: string
  /**
   * The date, when this turn is on a different day from the conversation's
   * first. A bare clock time is unambiguous for exactly as long as the
   * conversation stays inside one day -- the same hole `startedLabel` was
   * written to close on the mission rule above this one.
   */
  readonly day?: string
  readonly note?: string
}): ReactElement {
  return (
    <div
      className="lc-timemark"
      role="separator"
      aria-label={`${day === undefined ? '' : `${day}, `}${clockTime(at)}, ${String(minutesIn)} minutes in`}
    >
      <span className="lc-timemark__line" aria-hidden="true" />
      <span className="lc-timemark__text lc-mono">
        {day !== undefined && `${day} · `}
        {clockTime(at)} · {elapsed}
        {note !== undefined && ` · ${note}`}
      </span>
      <span className="lc-timemark__line" aria-hidden="true" />
    </div>
  )
}
