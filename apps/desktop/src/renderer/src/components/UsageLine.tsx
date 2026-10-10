import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { UsageReadResponse } from '../../../shared/ipc.js'
import type { UsageRange, UsageSummary } from '../../../shared/usage.js'
import { dayLabel, plural, sparkBars, usageLineFacts } from '../usageView.js'
import { Icon } from './Icon.js'

/**
 * USAGE ON HOME (0.714).
 *
 * Colin, 2026-10-09, of a usage page across every agent: "that sounds pretty
 * cool just make sure its very well designed and not sloppy." Home already
 * says how close each account is to its limit, on the agents' marks; what it
 * never said is how much has been done. So one line in the accounts' own
 * register -- a label, the month's turns, tokens and money, a bar a day --
 * that opens the whole picture. It is drawn only once there is something to
 * count: a new person's Home is unchanged.
 *
 * HOME FITS, STILL. Colin's rule for Home is no scrollbar that goes to
 * nothing (first-screen-fits.mjs). The line sits in the accounts' block, so
 * it costs no gap, and at Colin's 1209x770 and at 1366x768 Home fits as it
 * did without it (look-usage.mjs measures both). A window 720px tall was
 * already short; there the line folds into a chip on the accounts' row --
 * the bars and the word -- by the window's height alone (shell.css), so
 * nothing measures itself and nothing can flip back and forth.
 */
export function useUsageSummary(readUsage: ((range: UsageRange) => Promise<UsageReadResponse>) | undefined, refreshKey: string): UsageSummary | undefined {
  const [summary, setSummary] = useState<UsageSummary>()
  useEffect(() => {
    if (readUsage === undefined) return
    let live = true
    void readUsage('30d')
      .then((answer) => {
        if (live && answer.ok) setSummary(answer.summary)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [refreshKey])
  return summary
}

function Spark({ summary }: { readonly summary: UsageSummary }): ReactElement {
  return (
    <span className="lc-usageline__spark" aria-hidden="true">
      {sparkBars(summary.days, summary.today).map((bar) => (
        <span
          key={bar.date}
          className={`lc-usageline__bar${bar.today ? ' is-today' : ''}${bar.turns === 0 ? ' is-empty' : ''}`}
          style={{ height: bar.turns === 0 ? undefined : `${String(Math.round(bar.height * 100))}%` }}
          title={`${dayLabel(bar.date)}: ${plural(bar.turns, 'turn')}`}
        />
      ))}
    </span>
  )
}

const OPEN_TITLE = 'Every agent and model: limits, activity and what each used'

/** The line under the accounts. */
export function UsageLine({ summary, onOpen }: { readonly summary: UsageSummary | undefined; readonly onOpen: () => void }): ReactElement | null {
  if (summary === undefined || summary.turns === 0) return null
  return (
    <div className="lc-agenthead lc-usageline">
      <span className="lc-agenthead__label">Usage</span>
      <span className="lc-agenthead__note">last 30 days</span>
      <button type="button" className="lc-usageline__open" onClick={onOpen} title={OPEN_TITLE}>
        <span className="lc-usageline__facts">{usageLineFacts(summary)}</span>
        <Spark summary={summary} />
        <span className="lc-usageline__more">
          Details
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
    </div>
  )
}

/** The same, folded into the accounts' row, where a short window has no line to give it. */
export function UsageChip({ summary, onOpen }: { readonly summary: UsageSummary | undefined; readonly onOpen: () => void }): ReactElement | null {
  if (summary === undefined || summary.turns === 0) return null
  return (
    <button type="button" className="lc-usagechip" onClick={onOpen} title={`${usageLineFacts(summary)} in the last 30 days. ${OPEN_TITLE}`}>
      <Spark summary={summary} />
      Usage
    </button>
  )
}
