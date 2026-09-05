import type { ReactElement } from 'react'

import { costLine } from '../cost.js'
import type { ExchangeOverview } from '../exchange.js'
import { Icon } from './Icon.js'

/**
 * One line above a conversation that is part of an exchange: who is in it
 * and on what, how much of the automatic-reply budget it has used, what it
 * has cost, and a way to stop all of it.
 *
 * The tester on 0.21.2 (rec. 6) asked for exactly this list. It reads from
 * the records the window already holds, so what it says is what the ledger
 * says; the budget is the person's own number from Settings.
 */
export function ExchangeStrip({
  exchange,
  cap,
  runtimeNameOf,
  onStop,
  stopping
}: {
  readonly exchange: ExchangeOverview
  readonly cap: number
  readonly runtimeNameOf: (id: string) => string
  readonly onStop: () => void
  readonly stopping: boolean
}): ReactElement {
  const live = exchange.liveRunIds.length > 0
  const cost = costLine(exchange.cost)
  return (
    <div className="lc-exchange" role="status" aria-label="Exchange">
      <span className="lc-exchange__label">
        <Icon name="users" size={12} />
        Exchange
      </span>
      <span className="lc-exchange__who">
        {exchange.participants.map((participant, index) => (
          <span key={participant.teammateId} className="lc-exchange__part">
            {index > 0 && <span className="lc-separator">·</span>}
            <span className={`lc-dot ${participant.live ? 'lc-tone-lime is-pulsing' : 'lc-tone-muted'}`} />
            <span className="lc-exchange__name">{participant.name}</span>
            <span className="lc-exchange__route lc-mono">
              {runtimeNameOf(participant.runtime)} / {participant.model === 'account-default' ? 'default' : participant.model}
            </span>
          </span>
        ))}
      </span>
      <span className="lc-exchange__facts lc-mono">
        {/* Hops used of the budget: "3 of 6 automatic replies". The cap is
          * the person's own number from Settings, so this reads as a budget
          * rather than a constant. */}
        <span title="Automatic replies used of the budget set in Settings">
          {String(exchange.hops)} of {String(cap)} automatic {cap === 1 ? 'reply' : 'replies'}
        </span>
        {cost !== undefined && (
          <>
            <span className="lc-separator">·</span>
            <span title="Everything every run in this exchange reported spending">{cost}</span>
          </>
        )}
      </span>
      {live && (
        <button
          type="button"
          className="lc-button lc-button--danger lc-exchange__stop"
          onClick={onStop}
          disabled={stopping}
          title="Stop every run in this exchange. Nothing is deleted; the records stay."
        >
          {stopping ? 'Stopping…' : `Stop ${exchange.liveRunIds.length === 1 ? 'the run' : `${String(exchange.liveRunIds.length)} runs`}`}
        </button>
      )}
    </div>
  )
}
