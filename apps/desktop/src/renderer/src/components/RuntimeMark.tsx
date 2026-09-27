import type { ReactElement } from 'react'

import { isMissionRuntime } from '../../../shared/runtimes.js'
import { RUNTIME_MARKS } from '../runtimeMarks.js'

/**
 * A RUNTIME'S MARK, beside the words that name it (0.383).
 *
 * Where each shape comes from is in `runtimeMarks.ts`. The mark is drawn in
 * the brand's own colour where the colour is part of the mark (Claude's
 * orange: a token, painted by `data-runtime` in shell.css), and otherwise in
 * the words', so it sits in any line without a second palette. `is-muted`
 * greys it with its words, for a runtime that cannot take work.
 *
 * Decorative by default: every place that draws one also says the runtime in
 * words -- the chip, the row, or the title -- so a screen reader is not told
 * twice. Where the mark IS the name (Home's folded agents line), pass
 * `label` and it is announced as that. Anything that is not a runtime a
 * teammate runs on (the OmniRoute gateway) has no mark, and draws nothing.
 */
export function RuntimeMark({
  runtime,
  size = 12,
  label,
  className
}: {
  readonly runtime: string
  readonly size?: number
  readonly label?: string
  readonly className?: string
}): ReactElement | null {
  if (!isMissionRuntime(runtime)) return null
  const mark = RUNTIME_MARKS[runtime]
  return (
    <svg
      className={`lc-runtimemark${className === undefined ? '' : ` ${className}`}`}
      data-runtime={runtime}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      focusable="false"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {label !== undefined && <title>{label}</title>}
      {mark.paths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
      {mark.strokes?.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}
