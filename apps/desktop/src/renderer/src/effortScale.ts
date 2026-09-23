/**
 * Reasoning effort as a SCALE, not a list.
 *
 * Cursor lists eight levels -- low, low-fast, medium, medium-fast, high,
 * high-fast, xhigh, xhigh-fast -- and a menu with eight rows in it ran off the
 * bottom of the window and off its right edge (Colin, 2026-09-08: "this is way
 * too much").
 *
 * His fix, and it is the right one: "you could just use claudes since you
 * already have access to it, and then if there is a fast option just have a
 * toggle for it." Claude's own control is a slider from Faster to Smarter with
 * the level named above it. Those eight levels are not eight things -- they
 * are FOUR, each available in a normal and a fast variant. One slider and one
 * switch says the same thing in two controls instead of eight rows.
 *
 * The split is done here rather than in the component because it has to be
 * reversible: what the slider and the switch mean together has to turn back
 * into a level string the runtime actually listed, and never into one it did
 * not. A control that can produce `medium-fast` for a runtime that never
 * offered it would fail a run at the far end, which is the whole class of bug
 * the Cursor effort work has been about all week.
 */

export interface EffortScale {
  /** The base levels, lowest first, as the runtime named them. */
  readonly bases: readonly string[]
  /** Whether any level has a faster variant, i.e. whether to draw the switch. */
  readonly hasFast: boolean
}

/** `high-fast` -> `{ base: 'high', fast: true }`. */
export function splitEffort(level: string): { readonly base: string; readonly fast: boolean } {
  return level.endsWith('-fast') && level.length > '-fast'.length
    ? { base: level.slice(0, -'-fast'.length), fast: true }
    : { base: level, fast: false }
}

/**
 * The effort words this app has ever been shown, least to most.
 *
 * "Order is the runtime's own, first appearance wins" was the rule here, on
 * the reasoning that the catalogue lists them lowest to highest and a
 * hard-coded ordering would put an unfamiliar level in the wrong place.
 *
 * THE PREMISE IS FALSE FOR CURSOR, and it produced a control that contradicted
 * itself. `cursor-agent --help` lists `cursor-grok-4.6-high-fast` BEFORE
 * `cursor-grok-4.6-low`, so first-appearance made the scale
 * `[high, low, medium, xhigh]` -- and a teammate on `high` drew its knob hard
 * left against "Faster" while the word above it said `high` and the line under
 * it said "slower, costlier" (Colin, 2026-09-11, screenshot). MEASURED on the
 * same build: a route on `medium` put the knob at 67%, which is index 2 of
 * that same wrong order.
 *
 * This is not knowing better than the runtime about what its levels MEAN. It
 * is knowing that a slider's entire meaning is "right is more", so a scale
 * that is not sorted is not a scale. A word this list has never seen keeps its
 * first-appearance order and sits after the ones it knows, which is the
 * original rule applied where it still holds.
 */
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Where a level sits, or `undefined` for a word this build has not seen. */
export function effortRank(base: string): number | undefined {
  const at = EFFORT_ORDER.indexOf(base as (typeof EFFORT_ORDER)[number])
  return at < 0 ? undefined : at
}

/**
 * The scale a runtime's levels describe, least to most.
 *
 * Sorted rather than taken as listed -- see `EFFORT_ORDER` above for the
 * measurement that forced it.
 */
export function effortScale(supported: readonly string[]): EffortScale {
  const bases: string[] = []
  let hasFast = false
  for (const level of supported) {
    const { base, fast } = splitEffort(level)
    if (fast) hasFast = true
    if (!bases.includes(base)) bases.push(base)
  }
  const seen = new Map(bases.map((base, index) => [base, index]))
  const sorted = [...bases].sort((a, b) => {
    const rankA = effortRank(a)
    const rankB = effortRank(b)
    // Both known: the scale's own order. One known: the known one first, so an
    // unfamiliar word cannot land between `low` and `medium` and claim a
    // meaning nothing gave it. Neither: the runtime's own order, unchanged.
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB
    if (rankA !== undefined) return -1
    if (rankB !== undefined) return 1
    return (seen.get(a) ?? 0) - (seen.get(b) ?? 0)
  })
  return { bases: sorted, hasFast }
}

/**
 * What the slider and the switch mean together, as a level that EXISTS.
 *
 * Asking for fast when this base has no fast variant gives the plain one
 * rather than a string the runtime never listed.
 */
export function joinEffort(base: string, fast: boolean, supported: readonly string[]): string | undefined {
  const wanted = fast ? `${base}-fast` : base
  if (supported.includes(wanted)) return wanted
  if (supported.includes(base)) return base
  return undefined
}

/**
 * A model's levels in words, for the one line a picker row has: "Low, High",
 * "Low to Max · Fast". The raw list -- `low, low-fast, medium, ...` -- is the
 * hover's; ten ids on a line read as a config file, which is what every
 * Cursor row did beside "Listed by cursor-agent --list-models" (2026-09-23).
 * Undefined for a model with no levels at all.
 */
export function levelsLine(supported: readonly string[], name: (level: string) => string): string | undefined {
  const { bases, hasFast } = effortScale(supported)
  if (bases.length === 0) return undefined
  const words = bases.map(name)
  const span = words.length <= 3 ? words.join(', ') : `${words[0] ?? ''} to ${words[words.length - 1] ?? ''}`
  return hasFast ? `${span} · Fast` : span
}
