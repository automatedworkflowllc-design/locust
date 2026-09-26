import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * WHAT A TEAMMATE SPENDS, IN MONEY, BY THE MONTH.
 *
 * Two units are money here, and nothing else is. Dollars, when a runtime
 * priced the run itself -- Claude Code on an API key, OpenCode on a paid
 * model. And Copilot's premium requests, which its plan meters. A run on a
 * subscription reports what the same tokens would have cost on the API,
 * which nobody paid, so it is left out, as the window has always left it out
 * (cost.ts); token counts are a measurement, not a cost.
 *
 * Read by the host, which is the only side that can see every conversation:
 * the window is sent events for the newest twenty, so a total it adds up is
 * short by everything older (found designing the monthly limit, 2026-09-26).
 */
export interface Spend {
  /** Dollars the runtimes priced. */
  readonly usd?: number
  /** Copilot's premium requests: shown, never limited here -- GitHub limits their overage itself. */
  readonly premiumRequests?: number
}

/** One run's money and the moment it ended, which is the month it counts in. */
export interface RunMoney extends Spend {
  readonly at: string
}

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * The money in one run's usage record, by the receipt's own words, and
 * whether a plan paid for it. The window's cost line reads the same record
 * through this, so the two can never price a run differently.
 */
export function moneyOfUsage(usage: Record<string, unknown>): Spend & { readonly plan: boolean } {
  const plan = usage.billing === 'subscription'
  const usd = plan ? undefined : amount(usage.usd ?? usage.totalCostUsd ?? usage.total_cost_usd)
  const premiumRequests = amount(usage.premiumRequests)
  return { ...(usd === undefined ? {} : { usd }), ...(premiumRequests === undefined ? {} : { premiumRequests }), plan }
}

/** A run's money, read off its `run.completed`; undefined when it has none. */
export function moneyOfRun(events: readonly NormalizedRuntimeEvent[]): RunMoney | undefined {
  const completed = events.find((event) => event.type === 'run.completed')
  if (completed === undefined) return undefined
  const usage = (completed.payload as { readonly usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return undefined
  const money = moneyOfUsage(usage as Record<string, unknown>)
  if (money.usd === undefined && money.premiumRequests === undefined) return undefined
  return {
    ...(money.usd === undefined ? {} : { usd: money.usd }),
    ...(money.premiumRequests === undefined ? {} : { premiumRequests: money.premiumRequests }),
    at: completed.occurredAt
  }
}

/** Added up; undefined when nothing in the list was money. */
export function sumSpend(list: readonly (Spend | undefined)[]): Spend | undefined {
  let usd: number | undefined
  let premiumRequests: number | undefined
  for (const spend of list) {
    if (spend?.usd !== undefined) usd = (usd ?? 0) + spend.usd
    if (spend?.premiumRequests !== undefined) premiumRequests = (premiumRequests ?? 0) + spend.premiumRequests
  }
  if (usd === undefined && premiumRequests === undefined) return undefined
  return { ...(usd === undefined ? {} : { usd }), ...(premiumRequests === undefined ? {} : { premiumRequests }) }
}

/**
 * The calendar month a moment falls in, on this machine's clock: `2026-09`.
 * A person's "this month" is their own, not UTC's -- a run at 9 pm on the
 * 30th in New York is September's.
 */
export function monthOf(at: string | Date): string | undefined {
  const date = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(date.getTime())) return undefined
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** "October 1": when this month's spending starts again from nothing. */
export function nextMonthStarts(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

/** The largest monthly limit a teammate may be given, in dollars. */
export const MAX_MONTHLY_LIMIT_USD = 100_000

/** A monthly limit in dollars: a positive amount, to the cent, no larger than the cap. */
export function isMonthlyLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.01 && value <= MAX_MONTHLY_LIMIT_USD
}

/** Dollars as the app writes them everywhere else: `$5.00`, `< $0.01`. */
export function dollars(usd: number): string {
  return usd > 0 && usd < 0.01 ? '< $0.01' : `$${usd.toFixed(2)}`
}

/**
 * Why a run was not started, when the teammate has reached the limit the
 * person set: what was spent, against what, and the two ways on.
 *
 * Reached means AT the limit as well as over it. The check is made before a
 * run starts, and a run's cost is known only when it ends -- so the run that
 * crosses the line finishes, and the next one is the one refused.
 */
export function limitReached(spent: Spend | undefined, limitUsd: number): boolean {
  return (spent?.usd ?? 0) >= limitUsd
}

export function limitRefusal(name: string, spent: Spend | undefined, limitUsd: number, now: Date): string {
  return `${name} has reached this month's limit: ${dollars(spent?.usd ?? 0)} of ${dollars(limitUsd)}. Raise the limit by editing ${name}, or it starts again on ${nextMonthStarts(now)}.`
}
