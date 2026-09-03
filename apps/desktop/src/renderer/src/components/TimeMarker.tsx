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
  note
}: {
  readonly at: string
  readonly minutesIn: number
  readonly note?: string
}): ReactElement {
  return (
    <div className="lc-timemark" role="separator" aria-label={`${clockTime(at)}, ${String(minutesIn)} minutes in`}>
      <span className="lc-timemark__line" aria-hidden="true" />
      <span className="lc-timemark__text lc-mono">
        {clockTime(at)} · {minutesIn} min in
        {note !== undefined && ` · ${note}`}
      </span>
      <span className="lc-timemark__line" aria-hidden="true" />
    </div>
  )
}
