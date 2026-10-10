import type { ReactElement } from 'react'

import { usageReadOf, usageWindowLabel, usageWindowSentence, usageWindowsOf } from '../missionView.js'

/**
 * AN AGENT'S LIMITS, AS METERS (design pass, 0.715).
 *
 * Settings > AI agents said them as one sentence -- "100% of the Gemini:
 * 5-hour window left · 67% of the Gemini: weekly window left, resets Sat
 * 16:49 · 100% of the Claude and GPT: 5-hour window left · 20% of ..." --
 * three lines, and ALL amber because one window had passed 80% (the 0.712
 * frame). A meter each, as Usage and the agents' hover cards draw them: the
 * window, a bar, its figure; amber or red only on the window that is.
 * The sentence, resets and all, is the meters' tooltip.
 */
export function UsageMeters({ said, now = new Date() }: { readonly said: string; readonly now?: Date }): ReactElement {
  const windows = usageWindowsOf(said, now)
  const read = usageReadOf(said)
  return (
    <span className="lc-meters" title={usageWindowSentence(said, now)}>
      {windows.map((window) => {
        const name = window.name.replace(/ window$/, '')
        const label = name.charAt(0).toUpperCase() + name.slice(1)
        if (window.expired === true) {
          return (
            <span className="lc-meter is-reset" key={window.name}>
              <span className="lc-meter__name">{label}</span>
              <span className="lc-meter__figure">reset since</span>
            </span>
          )
        }
        const tone = window.percent >= 100 ? ' is-spent' : window.percent >= 80 ? ' is-pressing' : ''
        return (
          <span className={`lc-meter${tone}`} key={window.name}>
            <span className="lc-meter__name">{label}</span>
            <span className="lc-meter__bar" aria-hidden="true">
              <span className="lc-meter__fill" style={{ width: `${String(Math.min(100, window.percent))}%` }} />
            </span>
            <span className="lc-meter__figure">{window.remaining === undefined ? `${String(window.percent)}% used` : `${String(window.remaining)}% left`}</span>
          </span>
        )
      })}
      {read !== undefined && <span className="lc-meters__read">as of {usageWindowLabel(read.at)}</span>}
    </span>
  )
}
