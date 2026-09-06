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
export function ContextRing({ reading }: { readonly reading: ContextReading }): ReactElement {
  const size = 14
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const filled = (Math.min(100, Math.max(0, reading.percent)) / 100) * circumference
  // Amber past four fifths, for the same reason the usage window turns amber:
  // it is the point where the next long turn may not fit.
  const tone = reading.percent >= 80 ? 'var(--lc-amber)' : 'var(--lc-text-muted)'
  return (
    <span
      className="lc-contextring"
      title={contextSentence(reading)}
      aria-label={contextSentence(reading)}
      role="img"
    >
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--lc-border-card)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${String(filled)} ${String(circumference)}`}
          // Start at the top rather than at three o'clock, which is where a
          // person reads a dial from.
          transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
        />
      </svg>
    </span>
  )
}
