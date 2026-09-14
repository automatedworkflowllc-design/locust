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

export function ContextRing({
  reading,
  conversationCost
}: {
  readonly reading: ContextReading
  readonly conversationCost?: string
}): ReactElement {
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
      title={ringSentence(reading, conversationCost)}
      aria-label={ringSentence(reading, conversationCost)}
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

/**
 * The conversation's spend, where there is no ring to hang it on.
 *
 * The ruling sent this number to the context ring. Measured afterwards:
 * **only Claude Code reports a context window**, so the ring renders for one
 * of seven runtimes and the fact would have vanished on the two Colin
 * actually drives. Same slot, same scope, stated rather than hidden --
 * which is the ruling's own principle applied where its surface is empty.
 */
export function ConversationSpend({ cost }: { readonly cost: string }): ReactElement {
  return (
    <span
      className="lc-composer__spend"
      title={`This conversation: ${cost}`}
      aria-label={`This conversation: ${cost}`}
    >
      {cost}
    </span>
  )
}
