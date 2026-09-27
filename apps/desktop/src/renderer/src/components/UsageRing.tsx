import type { ReactElement, ReactNode } from 'react'

/**
 * HOW FULL AN ACCOUNT'S WINDOW IS, AROUND ITS MARK (0.388).
 *
 * Orca shows each account's usage in a status bar ("Claude 78% 5h · 94%
 * wk") -- partly by reading the agents' own account files, which Locust never
 * touches. Locust has what the runs themselves report: Claude's rate-limit
 * windows on every run, and Codex's since 0.388 (`*.usage_window`). The
 * fullest window becomes a thin ring round the runtime's mark: muted while
 * there is room, amber from 80% -- when a long run may not finish -- and red
 * when the window is spent. The exact words are the mark's name and hover.
 */
export function UsageRing({ used, size, children }: { readonly used: number; readonly size: number; readonly children: ReactNode }): ReactElement {
  const box = size + 8
  const middle = box / 2
  const radius = middle - 1
  const around = 2 * Math.PI * radius
  const filled = (around * Math.max(0, Math.min(100, used))) / 100
  const tone = used >= 100 ? ' is-spent' : used >= 80 ? ' is-pressing' : ''
  return (
    <span className={`lc-usagering${tone}`} style={{ width: box, height: box }} data-used={Math.round(used)}>
      <svg className="lc-usagering__ring" width={box} height={box} viewBox={`0 0 ${String(box)} ${String(box)}`} aria-hidden="true" focusable="false">
        <circle className="lc-usagering__track" cx={middle} cy={middle} r={radius} fill="none" strokeWidth={1.5} />
        {/* Nothing used, no arc: a round cap on an empty arc is a dot at
            twelve o'clock, which reads as a glitch (0.388's first frame). */}
        {filled >= 0.5 && (
          <circle
            className="lc-usagering__arc"
            cx={middle}
            cy={middle}
            r={radius}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={`${filled.toFixed(2)} ${around.toFixed(2)}`}
            transform={`rotate(-90 ${String(middle)} ${String(middle)})`}
          />
        )}
      </svg>
      {children}
    </span>
  )
}
