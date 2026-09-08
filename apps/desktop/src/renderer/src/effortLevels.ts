/**
 * What each reasoning-effort level actually means, said only where it is known.
 *
 * The menu listed bare words -- `low`, `medium`, `high` -- which tells someone
 * choosing between them nothing at all (design pass: "effort menu with
 * per-level cost descriptions"). The design mock writes them out: Fast "skips
 * extended thinking, lowest latency", Max "deepest reasoning, slowest, usually
 * costliest".
 *
 * The catch is that THE LEVELS ARE NOT OURS. `supportedEfforts` comes from
 * whatever the runtime listed, and it differs per runtime: Cursor lists
 * `low / high / high-fast`, Claude `low / medium / high`, and a future model
 * could list anything. So a fixed four-row table would end up describing a
 * level the runtime does not have, or worse, putting a confident sentence
 * under a word it invented a meaning for.
 *
 * So: a level this file recognises gets a description; one it does not gets
 * NO description rather than a guess. An undescribed level still reads as
 * itself, which is exactly what it did before, and nothing on screen claims
 * anything untrue.
 */

/**
 * The descriptions, keyed by the level name as runtimes actually write it.
 *
 * Deliberately about TIME and COST rather than quality. "Thinks harder" is an
 * unfalsifiable claim about an answer nobody has seen yet; "takes longer and
 * usually costs more" is the trade the person is actually making, and it is
 * the one they can check afterwards on the receipt.
 */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  minimal: 'barely reasons — fastest and cheapest',
  low: 'little reasoning — fastest, cheapest',
  fast: 'skips extended thinking — lowest latency',
  medium: 'a middle amount of reasoning',
  balanced: 'a middle amount of reasoning',
  high: 'reasons at length — slower, usually costlier',
  'high-fast': 'reasons at length, on the faster variant of the model',
  max: 'deepest reasoning — slowest, usually costliest',
  xhigh: 'deepest reasoning — slowest, usually costliest'
}

/** What this level means, or undefined when this build cannot say. */
export function effortDescription(level: string): string | undefined {
  return DESCRIPTIONS[level.toLowerCase()]
}

/**
 * The line under the menu, when there is one worth drawing.
 *
 * Only ever states something checkable about the runtime in hand. For Cursor
 * the effort is not a flag at all -- it is part of the model name, which is
 * why choosing one changes the model shown in the composer, and why the same
 * choice is refused if it is sent beside the model instead of inside it. That
 * surprised the app itself as recently as 2026-09-07, so it is worth a line.
 */
export function effortFooter(runtime: string): string | undefined {
  return runtime === 'cursor'
    ? 'Cursor carries the effort inside the model name, so choosing one changes the model this runs on.'
    : undefined
}
