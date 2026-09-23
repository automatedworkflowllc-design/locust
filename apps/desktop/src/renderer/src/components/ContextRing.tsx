import type { ReactElement } from 'react'

import { contextSentence } from '../cost.js'
import type { ContextReading } from '../cost.js'

/**
 * How full this conversation's context is, as a ring.
 *
 * Drawn only where the runtime stated its own window -- Claude Code reports
 * `contextWindow` per model on every result. Nothing here estimates: a
 * runtime that does not say gets no ring rather than a ring against a
 * denominator the app made up (Colin asked for this on 2026-09-06, and the
 * measurement is what made it honest to build).
 *
 * The ring is 14px because it sits in the composer's control row beside the
 * route chip, and it carries the same sentence on hover that the tooltip
 * would say out loud.
 */
/**
 * What the hover says, now that it carries two facts.
 *
 * Design ruling, 2026-09-14: the conversation's total cost belongs on the
 * conversation-scoped object, not in the mission strip -- cost and context
 * are the same KIND of fact, "how much of a finite thing this conversation
 * has spent", and the hover already exists so nobody learns a new surface.
 */
export function ringSentence(reading: ContextReading | undefined, conversationCost: string | undefined): string {
  const lines = [
    reading === undefined ? undefined : contextSentence(reading),
    conversationCost === undefined ? undefined : `This conversation: ${conversationCost}`
  ].filter((line): line is string => line !== undefined)
  return lines.join(' — ')
}

/**
 * The used part as a slice from twelve o'clock, clockwise: an SVG path, or
 * undefined for nothing used. A full window is the whole disc.
 */
export function pieSlicePath(percent: number, centre: number, radius: number): string | undefined {
  const share = Math.min(100, Math.max(0, percent)) / 100
  if (share <= 0) return undefined
  if (share >= 0.999) {
    return `M ${String(centre - radius)} ${String(centre)} a ${String(radius)} ${String(radius)} 0 1 0 ${String(radius * 2)} 0 a ${String(radius)} ${String(radius)} 0 1 0 ${String(-radius * 2)} 0 Z`
  }
  const angle = share * 2 * Math.PI
  const x = centre + radius * Math.sin(angle)
  const y = centre - radius * Math.cos(angle)
  const round = (value: number): string => String(Math.round(value * 100) / 100)
  return `M ${round(centre)} ${round(centre)} L ${round(centre)} ${round(centre - radius)} A ${round(radius)} ${round(radius)} 0 ${angle > Math.PI ? 1 : 0} 1 ${round(x)} ${round(y)} Z`
}

/**
 * A PIE, not a ring.
 *
 * It was an arc on a 7% track, and beside the model chip after a run had
 * finished it read as a spinner still going (Yurt's beta report, 2026-09-23,
 * #8: "a spinner kept going next to the route chip. The header already said
 * completed"). Making the track visible did not help -- a bright arc on a
 * dim circle IS the spinner. A filled slice inside an outline is a portion
 * of something, which is what this says; nothing loads in a pie.
 */
export function ContextRing({
  reading,
  conversationCost
}: {
  readonly reading: ContextReading
  readonly conversationCost?: string
}): ReactElement {
  const size = 14
  const centre = size / 2
  // Amber past four fifths, for the same reason the usage window turns amber:
  // it is the point where the next long turn may not fit.
  const tone = reading.percent >= 80 ? 'var(--lc-amber)' : 'var(--lc-contextring-fill)'
  const slice = pieSlicePath(reading.percent, centre, 4.5)
  return (
    <span
      className="lc-contextring"
      title={ringSentence(reading, conversationCost)}
      aria-label={ringSentence(reading, conversationCost)}
      role="img"
    >
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden="true">
        <circle cx={centre} cy={centre} r={6.25} fill="none" stroke="var(--lc-contextring-track)" strokeWidth={1.5} />
        {slice !== undefined && <path d={slice} fill={tone} />}
      </svg>
    </span>
  )
}
