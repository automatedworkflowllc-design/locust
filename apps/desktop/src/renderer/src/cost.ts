import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * What a run cost, read off its receipt and never estimated.
 *
 * Every runtime that reports usage puts it on the `run.completed` event, each
 * in its own vocabulary: token counts from Codex, Cursor and OpenCode; a
 * dollar figure from Claude Code; premium-request counts from Copilot. The
 * numbers a person sees here are exactly those, in the runtime's own unit.
 * Where a runtime reports nothing, the line says so instead of showing a
 * zero -- a zero reads as "free", and free is a claim only the runtime can
 * make. OpenCode does make it, with an explicit cost of 0 on its free models.
 */

export interface RunCost {
  readonly inputTokens?: number
  readonly outputTokens?: number
  /** Dollars, only when the runtime itself priced the run. */
  readonly usd?: number
  /** Copilot's own unit: premium requests spent from the plan's allowance. */
  readonly premiumRequests?: number
  /**
   * What the last turn's prompt occupied, cached or not, and how big the
   * model says its window is. Both come from the runtime -- Claude Code's
   * result states `contextWindow` per model -- so a reading exists only
   * where one was reported, and no denominator is ever assumed.
   */
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly contextWindow?: number
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** The cost a run's receipt carries, or undefined when it carries none. */
export function runCostOf(events: readonly NormalizedRuntimeEvent[]): RunCost | undefined {
  const completed = events.find((event) => event.type === 'run.completed')
  if (completed === undefined) return undefined
  const usage = (completed.payload as { readonly usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const cost: RunCost = {
    ...(count(record.inputTokens ?? record.input_tokens) === undefined ? {} : { inputTokens: count(record.inputTokens ?? record.input_tokens) }),
    ...(count(record.outputTokens ?? record.output_tokens) === undefined ? {} : { outputTokens: count(record.outputTokens ?? record.output_tokens) }),
    ...(count(record.usd ?? record.totalCostUsd ?? record.total_cost_usd) === undefined ? {} : { usd: count(record.usd ?? record.totalCostUsd ?? record.total_cost_usd) }),
    ...(count(record.premiumRequests) === undefined ? {} : { premiumRequests: count(record.premiumRequests) }),
    ...(count(record.cacheReadTokens) === undefined ? {} : { cacheReadTokens: count(record.cacheReadTokens) }),
    ...(count(record.cacheWriteTokens) === undefined ? {} : { cacheWriteTokens: count(record.cacheWriteTokens) }),
    ...(count(record.contextWindow) === undefined ? {} : { contextWindow: count(record.contextWindow) })
  }
  return Object.keys(cost).length === 0 ? undefined : cost
}

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

/**
 * One short line, in the runtime's own unit. Dollars win when the runtime
 * priced the run; premium requests are Copilot's unit and are said as such;
 * tokens are shown as in/out. `undefined` means the receipt said nothing.
 */
/**
 * Whether a number is MONEY or merely a measurement.
 *
 * `costLine` falls back to a token count when a runtime reports no price, so
 * the same function returns "$0.04" and "12k in · 3k out" -- and everything
 * downstream called both of them a cost. Sol's beta review of 0.225.0, after
 * four runs on a model the picker labels "Free · no sign-in": Missions said
 * *"across 4 priced"* and the Team card put the token counts under a COST
 * heading. *"No currency charge was displayed, but 'priced' and 'cost'
 * contradict the route's free promise."*
 *
 * Right, and it is a truth problem rather than a wording preference: a person
 * choosing a free route is choosing it to avoid being charged, and the app
 * telling them their free runs were priced is the app appearing to contradict
 * its own first screen.
 *
 * `undefined` for a run that reported nothing stays `undefined`. Nothing here
 * decides a route is free -- it decides only what UNIT was reported, which is
 * the one thing the receipt actually says.
 */
export function costUnit(cost: RunCost | undefined): 'money' | 'usage' | undefined {
  if (cost === undefined) return undefined
  if (cost.usd !== undefined || cost.premiumRequests !== undefined) return 'money'
  if (cost.inputTokens !== undefined || cost.outputTokens !== undefined) return 'usage'
  return undefined
}

export function costLine(cost: RunCost | undefined): string | undefined {
  if (cost === undefined) return undefined
  if (cost.usd !== undefined) return cost.usd === 0 ? '$0.00' : cost.usd < 0.01 ? '< $0.01' : `$${cost.usd.toFixed(2)}`
  if (cost.premiumRequests !== undefined) {
    return `${String(cost.premiumRequests)} premium request${cost.premiumRequests === 1 ? '' : 's'}`
  }
  if (cost.inputTokens !== undefined || cost.outputTokens !== undefined) {
    return `${tokens(cost.inputTokens ?? 0)} in · ${tokens(cost.outputTokens ?? 0)} out`
  }
  return undefined
}

/**
 * What a conversation has cost so far, across every turn that reported one.
 *
 * Cost only existed on a receipt, and a receipt belongs to one mission -- so a
 * five-turn conversation kept its cost in five places and showed it in none of
 * them while any of it was happening. MEASURED 2026-09-03: the moment a person
 * most wants the number is while a run is going, and that was the one moment
 * it was never on screen.
 *
 * Nothing here is estimated. A turn that reported no usage contributes
 * nothing, and a conversation where no turn reported any returns undefined --
 * which the caller must render as silence, not as zero.
 */
export function conversationCost(
  earlierTurns: readonly { readonly events: readonly NormalizedRuntimeEvent[] }[],
  events: readonly NormalizedRuntimeEvent[]
): RunCost | undefined {
  return sumCosts([...earlierTurns.map((turn) => runCostOf(turn.events)), runCostOf(events)])
}

/** Sum what can be summed; a mixed list keeps every unit it saw. */
export function sumCosts(costs: readonly (RunCost | undefined)[]): RunCost | undefined {
  let total: RunCost | undefined
  for (const cost of costs) {
    if (cost === undefined) continue
    const held: RunCost = total ?? {}
    total = {
      ...held,
      ...(cost.inputTokens === undefined ? {} : { inputTokens: (held.inputTokens ?? 0) + cost.inputTokens }),
      ...(cost.outputTokens === undefined ? {} : { outputTokens: (held.outputTokens ?? 0) + cost.outputTokens }),
      ...(cost.usd === undefined ? {} : { usd: (held.usd ?? 0) + cost.usd }),
      ...(cost.premiumRequests === undefined ? {} : { premiumRequests: (held.premiumRequests ?? 0) + cost.premiumRequests })
    }
  }
  return total
}

/**
 * How full the model's context is, when the runtime said how big it is.
 *
 * The occupied part is the whole prompt the last turn sent -- what was
 * written fresh, what was written to cache, and what was read back from it.
 * A resumed turn sends almost nothing new and reads the rest from cache, so
 * `inputTokens` alone would report a nearly-full conversation as empty.
 *
 * Returns nothing at all where no window was reported. Every other runtime
 * is in that position today, and a ring drawn against a guessed denominator
 * would be a number the app made up about the person's own quota.
 */
export interface ContextReading {
  readonly usedTokens: number
  readonly windowTokens: number
  /** 0-100, rounded, and never above 100. */
  readonly percent: number
}

/**
 * The newest turn that reported a context reading.
 *
 * NOT the conversation's summed cost: tokens add up across turns, but the
 * window holds one prompt. Summing them would report a five-turn chat as
 * five times as full as it is. So this walks back from the latest turn and
 * takes the first reading it finds -- the live turn once it has settled,
 * otherwise the one before it.
 */
export function latestContext(
  earlierTurns: readonly { readonly events: readonly NormalizedRuntimeEvent[] }[],
  events: readonly NormalizedRuntimeEvent[]
): ContextReading | undefined {
  const newestFirst = [events, ...[...earlierTurns].reverse().map((turn) => turn.events)]
  for (const turn of newestFirst) {
    const reading = contextReading(runCostOf(turn))
    if (reading !== undefined) return reading
  }
  return undefined
}

export function contextReading(cost: RunCost | undefined): ContextReading | undefined {
  const windowTokens = cost?.contextWindow
  if (cost === undefined || windowTokens === undefined || windowTokens <= 0) return undefined
  const usedTokens = (cost.inputTokens ?? 0) + (cost.cacheReadTokens ?? 0) + (cost.cacheWriteTokens ?? 0)
  if (usedTokens <= 0) return undefined
  return {
    usedTokens,
    windowTokens,
    percent: Math.min(100, Math.round((usedTokens / windowTokens) * 100))
  }
}

/** The reading in the words the tooltip uses. */
export function contextSentence(reading: ContextReading): string {
  return `Context: ${tokens(reading.usedTokens)} of ${tokens(reading.windowTokens)} used, ${String(reading.percent)}%`
}

/**
 * What to say when the runtime reported no cost at all.
 *
 * Four surfaces each answered this themselves and each answered differently:
 * the Missions row drew `—`, the Team card said `not reported`, the thread's
 * receipt and the inspector said `not reported by the runtime`, and the
 * inspector alone knew to say something else while a run was still going.
 * One absence, four spellings, three of which are in view at the same time
 * (Grok's finding 6, 2026-09-13).
 *
 * `running` is the one real distinction and it is kept: a run that has not
 * finished has not reported a cost YET, which is a different fact from a
 * runtime that does not report costs. Everything else is the same sentence.
 */
export function costLineOrWhyNot(cost: RunCost | undefined, running = false): string {
  return costLine(cost) ?? (running ? 'reported when the run ends' : 'not reported by the runtime')
}

/**
 * The same fact where only a few characters fit -- a table cell, a row's
 * trailing column. An em dash on its own says "nothing here" without
 * claiming the run was free, which is the thing a `$0.00` would claim.
 */
export const COST_NOT_REPORTED_SHORT = '—'

/**
 * The cost part of the mission header line.
 *
 * Every other part of that line is a fact about ONE mission -- its id, its
 * model, its phase, its sandbox -- and the cost used to be the whole
 * conversation's. Grok measured what that does (2026-09-14, finding 2): a
 * mission cancelled before anything started, whose own ledger holds a
 * create, a cancel and no usage at all, wore "1.8k in · 189 out" -- the
 * previous completed turn's exact counts. A run that died on a provider
 * error wore the turn before IT. A stranger reads a number sitting beside a
 * mission id as that mission's, and it was not.
 *
 * So: this run's own cost, unlabelled because the line it joins is already
 * about this run; nothing at all when this run reported no number, which is
 * the honest answer for a run that never reached a model.
 *
 * The conversation's total is NOT here. It was, briefly, with the word
 * `conversation` on it -- and that is what pushed a seven-fact line past its
 * width and truncated on Colin's screen. Design ruling, 2026-09-14: it
 * belongs in the context ring, which is already the conversation-scoped
 * object drawing a conversation-scoped budget, because cost and context are
 * the same KIND of fact -- how much of a finite thing this conversation has
 * spent. See `conversationCostLine`.
 */
export function missionCostTail(input: {
  readonly events: readonly NormalizedRuntimeEvent[]
  readonly earlierTurns: readonly { readonly events: readonly NormalizedRuntimeEvent[] }[]
  readonly running: boolean
}): string {
  const run = costLine(runCostOf(input.events))
  return run === undefined ? '' : ' · ' + (input.running ? 'so far ' : '') + run
}

/**
 * The conversation's total, for the one surface that is conversation-scoped.
 *
 * The context ring already answers "how much of a finite thing has this
 * conversation spent"; cost is the same question with a different unit, so
 * it is one row inside a hover that already exists rather than a new surface
 * anybody has to find. Design ruling, 2026-09-14.
 */
export function conversationCostLine(
  earlierTurns: readonly { readonly events: readonly NormalizedRuntimeEvent[] }[],
  events: readonly NormalizedRuntimeEvent[]
): string | undefined {
  return costLine(conversationCost(earlierTurns, events))
}
