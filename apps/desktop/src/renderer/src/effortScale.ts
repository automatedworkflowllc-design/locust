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
 * The scale a runtime's levels describe.
 *
 * Order is the runtime's own, first appearance wins. The catalogue lists them
 * lowest to highest and this does not try to know better -- a hard-coded
 * ordering would put a level this build has never seen in the wrong place, and
 * the slider's whole meaning is that right is more.
 */
export function effortScale(supported: readonly string[]): EffortScale {
  const bases: string[] = []
  let hasFast = false
  for (const level of supported) {
    const { base, fast } = splitEffort(level)
    if (fast) hasFast = true
    if (!bases.includes(base)) bases.push(base)
  }
  return { bases, hasFast }
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
