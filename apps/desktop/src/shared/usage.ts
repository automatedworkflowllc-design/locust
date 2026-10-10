/**
 * USAGE, ACROSS EVERY AGENT AND MODEL (0.714).
 *
 * Claude Code's `/stats` and `/usage` answer two questions about one agent:
 * how much have I used, and how close am I to its limit. A person running
 * Locust has six agents and a dozen models, and every one of those numbers
 * already lands on a turn's receipt -- what was missing was one place that
 * adds them up (the 10/08 field scan: ClawMetry, Manifest and magpie all lead
 * with it). This is that adding up, done by the host over every turn the
 * ledger holds, not the newest twenty the window is sent.
 *
 * Nothing is estimated. A turn counts on the day it ended, on this machine's
 * clock. Its tokens and its money are its receipt's; a turn whose runtime
 * reported nothing still counts as a turn and adds nothing else. Tokens are
 * what the model READ and WROTE: Claude Code and OpenCode report the cached
 * part of a prompt beside the fresh part and Codex reports it inside, so a
 * prompt is added up in each runtime's own terms (`promptTokens`).
 */

/** One turn, as the host read it off the ledger. */
export interface UsageTurn {
  /** When it ended -- the moment it counts in. */
  readonly at: string
  readonly runtime: string
  /** The model the run reported running, else the one it was asked for. */
  readonly model: string
  /** The conversation's first turn, which names the conversation. */
  readonly conversation: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  /** Dollars, only when the runtime priced the run (an API key, a paid model). */
  readonly usd?: number
  /** Copilot's own unit. */
  readonly premiumRequests?: number
  /** A subscription paid for it: its dollar figure is what nobody paid. */
  readonly plan?: true
}

export type UsageRange = '7d' | '30d' | 'all'

export const USAGE_RANGES: readonly UsageRange[] = ['7d', '30d', 'all']

export function isUsageRange(value: unknown): value is UsageRange {
  return value === '7d' || value === '30d' || value === 'all'
}

/** Twelve weeks of days, as Claude Code's `/stats` draws them. */
export const HEATMAP_WEEKS = 12

export interface UsageTokens {
  /** What the model read: the fresh prompt and what came from the cache. */
  readonly prompt: number
  /** Of `prompt`, what was read from the cache. */
  readonly cached: number
  readonly output: number
  /**
   * The prompt of the turns whose runtime said how much came from its cache.
   * A runtime that says nothing about a cache is not a 0% cache, so the share
   * is taken over these alone (`cachedPercent`).
   */
  readonly cacheCounted: number
}

export interface UsageDay {
  /** `2026-10-09`, on this machine's clock. */
  readonly date: string
  readonly turns: number
  readonly tokens: number
}

/** How turns were paid for, in the receipts' own words. */
export interface UsagePay {
  readonly usd?: number
  readonly premiumRequests?: number
  /** Turns a subscription covered. */
  readonly planTurns: number
  /** Turns on a model whose id says it is free (`...-free`). */
  readonly freeTurns: number
}

export interface UsageModel extends UsagePay {
  readonly runtime: string
  readonly model: string
  readonly turns: number
  readonly tokens: UsageTokens
}

export interface UsageSummary {
  readonly range: UsageRange
  /** The first day counted; absent for all time. */
  readonly since?: string
  /** The day it was counted on. */
  readonly today: string
  readonly turns: number
  readonly conversations: number
  readonly tokens: UsageTokens
  /** Every model that ran in the range, most turns first. */
  readonly models: readonly UsageModel[]
  /** Money and plan turns in the range, every model together. */
  readonly pay: UsagePay
  /** Each day of the range, oldest first: what the line on Home draws. */
  readonly days: readonly UsageDay[]
  /** Twelve weeks to today, a week a column, Sunday first -- whatever the range. */
  readonly heatmap: readonly UsageDay[]
  readonly activeDays: number
  /** The days the range covers, for "21 of 30 days". */
  readonly rangeDays: number
  readonly streak: { readonly current: number; readonly longest: number }
  /** The day with the most turns in the range. */
  readonly busiest?: UsageDay
  /** When the first turn the ledger holds ended. */
  readonly firstAt?: string
}

function count(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * What a turn's model read, in its runtime's terms. Codex counts the cached
 * part inside its input; Claude Code and OpenCode count it beside it, so it
 * is added there -- or a long resumed conversation reads as nearly nothing.
 */
export function promptTokens(turn: Pick<UsageTurn, 'runtime' | 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  const input = count(turn.inputTokens)
  return turn.runtime === 'codex' ? input : input + count(turn.cacheReadTokens) + count(turn.cacheWriteTokens)
}

export function turnTokens(turn: UsageTurn): UsageTokens {
  const prompt = promptTokens(turn)
  const counted = turn.cacheReadTokens !== undefined || turn.cacheWriteTokens !== undefined
  return { prompt, cached: Math.min(prompt, count(turn.cacheReadTokens)), output: count(turn.outputTokens), cacheCounted: counted ? prompt : 0 }
}

const NO_TOKENS: UsageTokens = { prompt: 0, cached: 0, output: 0, cacheCounted: 0 }

function addTokens(a: UsageTokens, b: UsageTokens): UsageTokens {
  return { prompt: a.prompt + b.prompt, cached: a.cached + b.cached, output: a.output + b.output, cacheCounted: a.cacheCounted + b.cacheCounted }
}

export function totalTokens(tokens: UsageTokens): number {
  return tokens.prompt + tokens.output
}

/**
 * The share of what the model read that came from its cache, 0-100, over the
 * turns whose runtime counts a cache; undefined where none did.
 */
export function cachedPercent(tokens: UsageTokens): number | undefined {
  return tokens.cacheCounted === 0 ? undefined : Math.round((Math.min(tokens.cached, tokens.cacheCounted) / tokens.cacheCounted) * 100)
}

/** `2026-10-09`, on this machine's clock. */
export function localDate(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/** The local date `days` before `date`, through month ends and clock changes. */
export function dayBefore(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return localDate(new Date(year!, month! - 1, day! - days))
}

function daysBetween(from: string, to: string): number {
  const utc = (date: string): number => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year!, month! - 1, day!)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

function isFreeModel(model: string): boolean {
  return /-free$/i.test(model)
}

function payOf(turns: readonly UsageTurn[]): UsagePay {
  let usd: number | undefined
  let premiumRequests: number | undefined
  let planTurns = 0
  let freeTurns = 0
  for (const turn of turns) {
    if (turn.plan === true) planTurns += 1
    else if (turn.usd !== undefined) usd = (usd ?? 0) + turn.usd
    if (turn.premiumRequests !== undefined) premiumRequests = (premiumRequests ?? 0) + turn.premiumRequests
    if (turn.plan !== true && isFreeModel(turn.model)) freeTurns += 1
  }
  return { ...(usd === undefined ? {} : { usd }), ...(premiumRequests === undefined ? {} : { premiumRequests }), planTurns, freeTurns }
}

/**
 * Every turn in the range, added up. `turns` may hold any order and any span;
 * the range is cut here, by the local day each turn ended. The streaks and the
 * heatmap look at every turn, as Claude Code's do, whatever the range.
 */
export function usageSummary(turns: readonly UsageTurn[], range: UsageRange, now: Date = new Date()): UsageSummary {
  const today = localDate(now)
  const dated = turns.flatMap((turn) => {
    const ended = new Date(turn.at)
    return Number.isNaN(ended.getTime()) ? [] : [{ turn, date: localDate(ended) }]
  })
  const rangeDays = range === '7d' ? 7 : range === '30d' ? 30 : undefined
  const since = rangeDays === undefined ? undefined : dayBefore(today, rangeDays - 1)
  // A turn dated after today (a clock set back since) counts in no range but all.
  const inRange = dated.filter(({ date }) => range === 'all' || (date >= since! && date <= today))

  const byDay = new Map<string, { turns: number; tokens: number }>()
  for (const { turn, date } of dated) {
    const held = byDay.get(date) ?? { turns: 0, tokens: 0 }
    byDay.set(date, { turns: held.turns + 1, tokens: held.tokens + totalTokens(turnTokens(turn)) })
  }
  const dayOf = (date: string): UsageDay => ({ date, ...(byDay.get(date) ?? { turns: 0, tokens: 0 }) })

  let first: string | undefined
  for (const { date } of dated) if (first === undefined || date < first) first = date
  const start = since ?? (first !== undefined && first < today ? first : today)
  const span = Math.max(0, daysBetween(start, today))
  const days = Array.from({ length: span + 1 }, (_, index) => dayOf(dayBefore(today, span - index)))

  // Twelve weeks ending with this one: whole weeks before it, then this week to today.
  const shown = (HEATMAP_WEEKS - 1) * 7 + now.getDay() + 1
  const heatmap = Array.from({ length: shown }, (_, index) => dayOf(dayBefore(today, shown - 1 - index)))

  const byModel = new Map<string, { runtime: string; model: string; turns: UsageTurn[] }>()
  for (const { turn } of inRange) {
    const key = `${turn.runtime}\u0000${turn.model}`
    const held = byModel.get(key) ?? { runtime: turn.runtime, model: turn.model, turns: [] }
    held.turns.push(turn)
    byModel.set(key, held)
  }
  const models: UsageModel[] = [...byModel.values()]
    .map((entry) => ({
      runtime: entry.runtime,
      model: entry.model,
      turns: entry.turns.length,
      tokens: entry.turns.reduce((sum, turn) => addTokens(sum, turnTokens(turn)), NO_TOKENS),
      ...payOf(entry.turns)
    }))
    .sort((a, b) => b.turns - a.turns || totalTokens(b.tokens) - totalTokens(a.tokens) || a.model.localeCompare(b.model))

  const everyDay = new Set(dated.map(({ date }) => date))
  // The current streak runs back from today -- or from yesterday, while today has nothing yet.
  let current = 0
  for (let at = everyDay.has(today) ? today : dayBefore(today, 1); everyDay.has(at); at = dayBefore(at, 1)) current += 1
  let longest = 0
  let run = 0
  let previous: string | undefined
  for (const date of [...everyDay].sort()) {
    run = previous !== undefined && daysBetween(previous, date) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }

  let busiest: UsageDay | undefined
  for (const day of days) if (day.turns > 0 && (busiest === undefined || day.turns > busiest.turns)) busiest = day
  let firstAt: string | undefined
  for (const { turn } of dated) if (firstAt === undefined || Date.parse(turn.at) < Date.parse(firstAt)) firstAt = turn.at

  return {
    range,
    ...(since === undefined ? {} : { since }),
    today,
    turns: inRange.length,
    conversations: new Set(inRange.map(({ turn }) => turn.conversation)).size,
    tokens: inRange.reduce((sum, { turn }) => addTokens(sum, turnTokens(turn)), NO_TOKENS),
    models,
    pay: payOf(inRange.map(({ turn }) => turn)),
    days,
    heatmap,
    activeDays: new Set(inRange.map(({ date }) => date)).size,
    rangeDays: rangeDays ?? days.length,
    streak: { current, longest },
    ...(busiest === undefined ? {} : { busiest }),
    ...(firstAt === undefined ? {} : { firstAt })
  }
}
