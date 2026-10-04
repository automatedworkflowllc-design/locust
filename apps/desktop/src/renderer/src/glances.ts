/**
 * TWO TEAMMATES LOOK AT EACH OTHER WHEN ONE HANDS THE OTHER A MESSAGE.
 *
 * Colin's "have fun" list, 2026-09-23 -- "Teammates notice each other ...
 * their two bots glance at each other for a moment" -- and his answer: "you
 * can run all those". Before this, a handoff showed only on the teammate who
 * got the message, looking around at nothing in particular ("listening"),
 * so nothing on screen said who it was from.
 *
 * A glance needs both faces on screen in one line of faces -- the sidebar's
 * strip is a row, its roster a column -- and says only which way to look:
 * the two turn toward each other, whoever is between them. A teammate in
 * two handoffs at once looks toward the latest.
 */

/** Which way a face looks: along a row, or along a column. */
export type GlanceSide = 'left' | 'right' | 'up' | 'down'

/** One teammate handing another a message, for as long as the moment lasts (App). */
export interface Handoff {
  /** The message's id: the same message is one moment, however often it is reported. */
  readonly key: string
  readonly from: string
  readonly to: string
}

export function glancesAmong(
  line: readonly string[],
  handoffs: readonly Handoff[],
  axis: 'row' | 'column'
): ReadonlyMap<string, GlanceSide> {
  const sides = new Map<string, GlanceSide>()
  const onward: GlanceSide = axis === 'row' ? 'right' : 'down'
  const back: GlanceSide = axis === 'row' ? 'left' : 'up'
  for (const handoff of handoffs) {
    const from = line.indexOf(handoff.from)
    const to = line.indexOf(handoff.to)
    if (from < 0 || to < 0 || from === to) continue
    sides.set(handoff.from, to > from ? onward : back)
    sides.set(handoff.to, to > from ? back : onward)
  }
  return sides
}
