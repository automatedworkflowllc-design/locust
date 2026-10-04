import { useState } from 'react'
import type { ReactElement } from 'react'

import { moneyLine } from '../cost.js'
import type { ExchangeOverview } from '../exchange.js'
import { Icon } from './Icon.js'
import { modelDisplayName, routeChrome } from '../routeName.js'
import { isMissionRuntime } from '../../../shared/runtimes.js'

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
  // Money, or nothing: the strip is read at a glance (`moneyLine`).
  const cost = moneyLine(exchange.cost)
  const [open, setOpen] = useState(false)

  // Over, and not open: one line. Everything the band said is still here --
  // it is just not a header on a conversation that has finished.
  if (!live && !open) {
    return (
      <button
        type="button"
        // Still the exchange, just collapsed. Dropping the .lc-exchange class
        // when it folds meant the strip stopped EXISTING as far as anything
        // looking for it was concerned -- assistive tech included, since the
        // role and label went with it.
        className="lc-exchange lc-exchange__rest"
        role="status"
        aria-label="Exchange"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        <Icon name="users" size={12} />
        <span className="lc-exchange__restline lc-mono">
          {exchange.participants.map((participant) => participant.name).join(' · ')}
          <span className="lc-separator">·</span>
          {String(exchange.hops)} of {String(cap)} automatic {cap === 1 ? 'reply' : 'replies'}
          {cost !== undefined && (
            <>
              <span className="lc-separator">·</span>
              {cost}
            </>
          )}
        </span>
        <Icon name="chevron-right" size={12} />
      </button>
    )
  }

  return (
    <div className="lc-exchange" role="status" aria-label="Exchange">
      {!live && (
        <button
          type="button"
          className="lc-exchange__fold"
          aria-expanded
          aria-label="Collapse the exchange"
          onClick={() => setOpen(false)}
        >
          <Icon name="chevron-down" size={12} />
        </button>
      )}
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
            <span className="lc-exchange__route lc-mono" title={`${runtimeNameOf(participant.runtime)} / ${participant.model}`}>
              {/* The chat bar's own spelling (routeChrome, 0.366): this printed
                  "OpenCode / opencode/muse-spark-1.3-contributor-free" three
                  times over a first delegation (Rook, packaged 0.366). The
                  exact id stays one hover away. */}
              {participant.model === 'account-default'
                ? `${runtimeNameOf(participant.runtime)} / default`
                : isMissionRuntime(participant.runtime)
                  ? routeChrome(participant.runtime, participant.model, modelDisplayName(participant.runtime, participant.model))
                  : `${runtimeNameOf(participant.runtime)} / ${participant.model}`}
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
