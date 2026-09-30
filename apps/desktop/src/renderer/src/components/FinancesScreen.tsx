import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import type { FinancesReadResponse } from '../../../shared/ipc.js'
import { monthsOf, recurringOf, spendByCategory } from '../../../shared/statements.js'
import type { Transaction } from '../../../shared/statements.js'
import { Icon } from './Icon.js'

/**
 * THE FINANCES DASHBOARD (0.506).
 *
 * Colin, 2026-09-30, of 0.501's Finances: "we definitely missed the mark" --
 * a tester is attached to ChatGPT's own Finances, a dashboard over accounts
 * linked through Plaid (help.openai.com/en/articles/20001222). Locust cannot
 * reach that connector (its app list answers 403), so this page is built from
 * the statements a person drops in the place's folder, and draws the widgets
 * statements can honestly fill: spend by category with a month picker, this
 * month against the months before, subscriptions and what is due next, fees
 * and interest, and every transaction. Net worth, holdings, market movers and
 * a credit score need linked accounts, and are not faked from a statement.
 *
 * The teammate is one question away: Ask sends it to the Finances teammate,
 * who reads the same files.
 */
const money = (value: number): string =>
  `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthName = (month: string): string => {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, (number ?? 1) - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
const shortDate = (iso: string): string => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function FinancesScreen({
  data,
  loading,
  onAsk,
  onOpenChat,
  onOpenFolder,
  onRefresh
}: {
  readonly data: FinancesReadResponse | undefined
  readonly loading: boolean
  readonly onAsk: (question: string) => void
  readonly onOpenChat: () => void
  readonly onOpenFolder: () => void
  readonly onRefresh: () => void
}): ReactElement {
  const [tab, setTab] = useState<'dashboard' | 'transactions'>('dashboard')
  const [question, setQuestion] = useState('')
  const transactions: readonly Transaction[] = data?.transactions ?? []
  const months = useMemo(() => monthsOf(transactions), [transactions])
  const [picked, setPicked] = useState<string>()
  const month = picked !== undefined && months.includes(picked) ? picked : months[0]
  const spend = useMemo(() => (month === undefined ? undefined : spendByCategory(transactions, month)), [transactions, month])
  // This month against the ones before it (up to three), as ChatGPT's "Spend this month" does.
  const before = useMemo(() => {
    if (month === undefined) return undefined
    // Only months a statement really covers: a month with a handful of rows is a statement's edge, not a month.
    const covered = (entry: string): boolean => transactions.filter((row) => row.date.startsWith(entry) && row.amount < 0).length >= 5
    const earlier = months.filter((entry) => entry < month && covered(entry)).slice(0, 3)
    if (earlier.length === 0) return undefined
    return earlier.reduce((sum, entry) => sum + spendByCategory(transactions, entry).total, 0) / earlier.length
  }, [transactions, months, month])
  const recurring = useMemo(() => recurringOf(transactions), [transactions])
  const fees = useMemo(() => (month === undefined ? [] : transactions.filter((row) => row.date.startsWith(month) && row.category === 'Fees')), [transactions, month])
  const ask = (text: string): void => {
    const words = text.trim()
    if (words.length === 0) return
    onAsk(words)
    setQuestion('')
  }
  const empty = !loading && transactions.length === 0

  return (
    <section className="lc-screen lc-finances" aria-label="Finances">
      <header className="lc-finances__head">
        <div className="lc-finances__title">
          <Icon name="wallet" size={18} />
          <h1>Finances</h1>
        </div>
        <div className="lc-finances__actions">
          <button type="button" className="lc-button" onClick={onOpenFolder} title="The folder your statements go in">
            <Icon name="folder" size={13} /> Add statements
          </button>
          <button type="button" className="lc-button" onClick={onRefresh} aria-label="Read the statements again" title="Read the statements again">
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </header>

      <form className="lc-finances__ask" onSubmit={(event) => { event.preventDefault(); ask(question) }}>
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your money…"
          aria-label="Ask the Finances teammate"
        />
        <button type="submit" className="lc-primarybutton" disabled={question.trim().length === 0}>Ask</button>
      </form>
      <p className="lc-finances__fine">Read from the statements in your Finances folder. Locust cannot move money and is not a financial adviser.</p>

      <nav className="lc-finances__tabs" aria-label="Finances views">
        <button type="button" className={tab === 'dashboard' ? 'is-on' : ''} aria-pressed={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</button>
        <button type="button" className={tab === 'transactions' ? 'is-on' : ''} aria-pressed={tab === 'transactions'} onClick={() => setTab('transactions')}>Transactions</button>
        <button type="button" onClick={onOpenChat}>Chats</button>
      </nav>

      {loading && <p className="lc-finances__note">Reading your statements…</p>}
      {empty && (
        <div className="lc-finances__empty">
          <h2>Add a statement to begin</h2>
          <p>
            Download a statement from your bank or card as CSV (most offer it under Transactions or Statements) and put
            it in your Finances folder. This page reads every CSV there: spending by category, what repeats, what is due.
          </p>
          <div className="lc-finances__starters">
            <button type="button" className="lc-primarybutton" onClick={onOpenFolder}>Open the Finances folder</button>
            <button type="button" className="lc-button" onClick={onOpenChat}>Start a chat</button>
          </div>
        </div>
      )}
      {(data?.files ?? []).some((file) => file.problem !== undefined || file.skipped > 0) && (
        <ul className="lc-finances__files" aria-label="Statements that did not read whole">
          {(data?.files ?? []).filter((file) => file.problem !== undefined || file.skipped > 0).map((file) => (
            <li key={file.name}>
              <span className="lc-mono">{file.name}</span> — {file.problem !== undefined ? `not read: ${file.problem}` : `${String(file.skipped)} ${file.skipped === 1 ? 'row' : 'rows'} without a date or amount left out`}
            </li>
          ))}
        </ul>
      )}

      {!empty && tab === 'dashboard' && spend !== undefined && month !== undefined && (
        <div className="lc-finances__grid">
          <article className="lc-fincard lc-fincard--wide" aria-label="Spend by category">
            <div className="lc-fincard__head">
              <div>
                <h2>Spend by category</h2>
                <label className="lc-finances__month">
                  <select value={month} onChange={(event) => setPicked(event.target.value)} aria-label="Month">
                    {months.map((entry) => <option key={entry} value={entry}>{monthName(entry)}</option>)}
                  </select>
                </label>
              </div>
              <span className="lc-fincard__total">{money(spend.total)}</span>
            </div>
            {spend.categories.length > 0 && (
              <div className="lc-finbar" role="img" aria-label={spend.categories.map((entry) => `${entry.category} ${money(entry.amount)}`).join(', ')}>
                {spend.categories.map((entry, index) => (
                  <span key={entry.category} className={`lc-finbar__part is-${String(Math.min(index, 5))}`} style={{ flexGrow: entry.amount }} title={`${entry.category}: ${money(entry.amount)}`} />
                ))}
              </div>
            )}
            <ul className="lc-fincats">
              {spend.categories.map((entry, index) => (
                <li key={entry.category}>
                  <button type="button" onClick={() => ask(`What did I spend on ${entry.category} in ${monthName(month)}? List the biggest ones.`)} title={`Ask about ${entry.category}`}>
                    <span className={`lc-fincats__dot is-${String(Math.min(index, 5))}`} aria-hidden="true" />
                    <span className="lc-fincats__name">{entry.category}</span>
                    <span className="lc-fincats__track"><span style={{ width: `${String(spend.total === 0 ? 0 : Math.round((entry.amount / spend.total) * 100))}%` }} /></span>
                    <span className="lc-fincats__amount">{money(entry.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </article>

          <article className="lc-fincard" aria-label="This month">
            <h2>{monthName(month)}</h2>
            <div className="lc-finfigure">
              <span className="lc-finfigure__label">Money out</span>
              <span className="lc-finfigure__value">{money(spend.total)}</span>
            </div>
            <div className="lc-finfigure">
              <span className="lc-finfigure__label">Money in</span>
              <span className="lc-finfigure__value is-in">{money(spend.income)}</span>
            </div>
            {before !== undefined && (
              <p className={`lc-finances__trend ${spend.total > before ? 'is-up' : 'is-down'}`}>
                {spend.total > before ? `${money(spend.total - before)} more` : `${money(before - spend.total)} less`} than your average of {money(before)} over the months before.
              </p>
            )}
          </article>

          <article className="lc-fincard" aria-label="Subscriptions and what is due">
            <h2>Subscriptions & bills</h2>
            {recurring.length === 0 ? (
              <p className="lc-finances__note">Nothing repeats yet. Two months of statements show what does.</p>
            ) : (
              <ul className="lc-finlist">
                {recurring.slice(0, 8).map((entry) => (
                  <li key={entry.description}>
                    <span className="lc-finlist__name">{entry.description}</span>
                    <span className="lc-finlist__meta">next around {shortDate(entry.nextAround)}</span>
                    <span className="lc-finlist__amount">{money(entry.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          {fees.length > 0 && (
            <article className="lc-fincard" aria-label="Fees and interest">
              <h2>Fees & interest</h2>
              <ul className="lc-finlist">
                {fees.map((row, index) => (
                  <li key={`${row.date}-${String(index)}`}>
                    <span className="lc-finlist__name">{row.description}</span>
                    <span className="lc-finlist__meta">{shortDate(row.date)}</span>
                    <span className="lc-finlist__amount">{money(-row.amount)}</span>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </div>
      )}

      {!empty && tab === 'transactions' && (
        <div className="lc-fintable-wrap">
          <table className="lc-fintable">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th className="is-num">Amount</th></tr>
            </thead>
            <tbody>
              {transactions.slice(0, 1000).map((row, index) => (
                <tr key={`${row.source}-${row.date}-${String(index)}`}>
                  <td className="lc-mono">{shortDate(row.date)}</td>
                  <td>{row.description}</td>
                  <td>{row.category}</td>
                  <td className={`is-num ${row.amount >= 0 ? 'is-in' : ''}`}>{money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
