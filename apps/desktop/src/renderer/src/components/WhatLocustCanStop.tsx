import type { ReactElement } from 'react'

import { runtimeDisplayName } from '../../../shared/runtimes.js'
import { STOP_REACH_LABEL, WHAT_LOCUST_CAN_STOP } from '../../../shared/what-locust-can-stop.js'
import { RuntimeMark } from './RuntimeMark.js'

/**
 * WHAT LOCUST CAN STOP, in Settings > AI agents (0.617; the PRD's R9).
 *
 * One row per AI agent: its name and how much of a run Locust's card can
 * stop, opening to what it asks first, what it does without asking, and who
 * keeps an Always. The words are shared/what-locust-can-stop.ts's, the same
 * ones docs/WHAT-LOCUST-CAN-STOP.md is written from. Folded, because the
 * question a person brings here is "which of mine asks me", and seven tags
 * answer it; the sentences are for the one they open.
 */
export function WhatLocustCanStop(): ReactElement {
  return (
    <div className="lc-settingcard">
      {WHAT_LOCUST_CAN_STOP.map((row) => (
        <details key={row.runtime} className="lc-stops__row">
          <summary className="lc-stops__summary">
            <RuntimeMark runtime={row.runtime} size={14} className="is-inline" />
            <span className="lc-stops__name">{runtimeDisplayName(row.runtime)}</span>
            <span className={`lc-tag${row.reach === 'each-action' ? ' is-green' : ''}`}>{STOP_REACH_LABEL[row.reach]}</span>
          </summary>
          <dl className="lc-stops__facts">
            <dt>Asks first</dt>
            <dd>{row.asks}</dd>
            <dt>Without asking</dt>
            <dd>{row.without}</dd>
            {row.always !== undefined && (
              <>
                <dt>Always</dt>
                <dd>{row.always}</dd>
              </>
            )}
          </dl>
        </details>
      ))}
    </div>
  )
}
