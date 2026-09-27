import { useId } from 'react'
import type { ReactElement } from 'react'

import { isMissionRuntime } from '../../../shared/runtimes.js'
import { RUNTIME_MARKS } from '../runtimeMarks.js'

/**
 * A RUNTIME'S MARK, beside the words that name it (0.383).
 *
 * Where each shape comes from is in `runtimeMarks.ts`. The mark is drawn in
 * the brand's own colour where the colour is part of the mark -- Claude's
 * orange, a token painted by `data-runtime` in shell.css; Gemini's gradient,
 * whose stops are tokens -- and otherwise in the words', so it sits in any
 * line without a second palette.
 *
 * `muted` greys it with its words, for a runtime that cannot take work: the
 * brand's colour goes too, gradient and all.
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
  muted = false,
  className
}: {
  readonly runtime: string
  readonly size?: number
  readonly label?: string
  readonly muted?: boolean
  readonly className?: string
}): ReactElement | null {
  // A gradient is found by id, and one page draws many marks: each its own.
  const gradientId = `lc-mark-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  if (!isMissionRuntime(runtime)) return null
  const mark = RUNTIME_MARKS[runtime]
  const painted = mark.gradient !== undefined && !muted
  const classes = ['lc-runtimemark', ...(muted ? ['is-muted'] : []), ...(className === undefined ? [] : [className])]
  return (
    <svg
      className={classes.join(' ')}
      data-runtime={runtime}
      viewBox={mark.viewBox ?? '0 0 24 24'}
      width={size}
      height={size}
      focusable="false"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {label !== undefined && <title>{label}</title>}
      {painted && (
        <defs>
          <radialGradient id={gradientId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={mark.gradient!.transform}>
            {mark.gradient!.stops.map((stop) => (
              <stop key={stop.token} offset={stop.offset} style={{ stopColor: `var(${stop.token})` }} />
            ))}
          </radialGradient>
        </defs>
      )}
      {mark.paths.map((d) => (
        <path key={d} d={d} fill={painted ? `url(#${gradientId})` : 'currentColor'} />
      ))}
      {mark.strokes?.map((d) => (
        <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}
