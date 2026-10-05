import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { AvatarSpec } from '../../../shared/avatar.js'
import { faceLabel } from '../faceState.js'
import type { FaceActivity } from '../faceState.js'
import { useCoverActivity } from '../useCoverActivity.js'
import { TeammateBot } from './TeammateBot.js'

/**
 * WHAT A FACE SAYS, IN TURN (2026-10-05). Settings > Appearance, beside
 * Terminal faces and Plush: one teammate going through every face a teammate
 * has, each named under it, in the app's own words for it (faceLabel).
 *
 * Colin: "we want the user to be able to see how much versatility the eyes
 * have, we dont want them locked behind tool calls the user may never use"
 * -- and of this page, "if its clean and production ready we can just ship
 * it". The faces are the real ones (TeammateBot, as the sidebar draws it:
 * its ring, its dot, its mood, its hop, the finish's green), so the legend
 * cannot say anything the app does not.
 *
 * It rests as Home's cover does (useCoverActivity, 0.623): behind other
 * windows, hidden, untouched for COVER_REST_AFTER_MS, or with reduced motion
 * asked for, it stops where it is, its clock and all, and costs nothing. A
 * click shows the next face whatever the motion setting, drawn still where
 * motion is reduced.
 */
export const FACE_LEGEND: readonly { readonly activity: FaceActivity; readonly seconds: number }[] = [
  { activity: 'idle', seconds: 2.6 },
  { activity: 'thinking', seconds: 3.4 },
  { activity: 'working', seconds: 3 },
  { activity: 'responding', seconds: 2.8 },
  { activity: 'done', seconds: 2.4 },
  { activity: 'waiting', seconds: 3 },
  { activity: 'receiving', seconds: 2.6 },
  { activity: 'blocked', seconds: 2.8 }
]

/** Its dot for each, as a teammate's is (status.ts's facePresenceFor). */
export function legendPresence(activity: FaceActivity): 'working' | 'approval' | 'blocked' | 'none' {
  switch (activity) {
    case 'thinking':
    case 'working':
    case 'delegating':
    case 'responding':
      return 'working'
    case 'waiting':
      return 'approval'
    case 'blocked':
      return 'blocked'
    default:
      return 'none'
  }
}

/** The face's name under it, said the way the app says it beside a face, in sentence case. */
export function legendName(activity: FaceActivity): string {
  const word = faceLabel(activity)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The teammate it shows: a droid, the shape whose screen is its whole face. */
const LEGEND_LOOK: AvatarSpec = { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' } }

export function FaceLegend(): ReactElement {
  const { paused, presence } = useCoverActivity()
  const [at, setAt] = useState(0)
  const shown = FACE_LEGEND[at % FACE_LEGEND.length] ?? { activity: 'idle' as const, seconds: 2.6 }
  // The next face once this one has had its time, unless it is resting.
  useEffect(() => {
    if (paused) return undefined
    const timer = setTimeout(() => setAt((current) => current + 1), shown.seconds * 1000)
    return () => clearTimeout(timer)
  }, [paused, at, shown.seconds])
  const name = legendName(shown.activity)
  return (
    <button
      type="button"
      className="lc-facelegend"
      data-face-legend={shown.activity}
      aria-label={`A teammate's face: ${name}. Show the next one.`}
      onClick={() => setAt((current) => current + 1)}
    >
      <span className="lc-settingline__bot">
        <TeammateBot
          hue="teal"
          avatar={LEGEND_LOOK}
          size={40}
          activity={shown.activity}
          presence={legendPresence(shown.activity)}
          teammateId="settings-face-legend"
          motionPresence={presence}
        />
      </span>
      <span className="lc-facelegend__name" aria-hidden="true">
        {name}
      </span>
    </button>
  )
}
