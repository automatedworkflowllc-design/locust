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
    ...(count(record.premiumRequests) === undefined ? {} : { premiumRequests: count(record.premiumRequests) })
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
