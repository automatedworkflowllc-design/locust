import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

/**
 * A destructive button that never acts on the first press (H2).
 *
 * The Team card's x and the routine Removes deleted on one click -- a
 * teammate with their routines, their conversations' ownership and any room
 * left empty -- while the same action from the right-click menu asked first.
 * This is that in-place ask, for a button: the first press arms it and says
 * what the second will do ("Remove, with 2 routines?"); the second does it.
 *
 * The second press must come at least `settleMs` after the first (M34: a
 * double-click satisfied every in-place "for good?", because its two clicks
 * are two presses). Moving focus away, or Escape, disarms it.
 */
export const SETTLE_MS = 400

export function ArmedButton({
  className,
  title,
  ariaLabel,
  armedLabel,
  disabled,
  onConfirm,
  children,
  now = () => Date.now()
}: {
  readonly className: string
  readonly title?: string
  readonly ariaLabel: string
  /** What the second press does, said on the button once armed. */
  readonly armedLabel: string
  readonly disabled?: boolean
  readonly onConfirm: () => void
  readonly children: ReactNode
  /** Test seam: the clock the settle interval is read on. */
  readonly now?: () => number
}): ReactElement {
  const [armedAt, setArmedAt] = useState<number>()
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (disabled === true) setArmedAt(undefined)
  }, [disabled])
  const armed = armedAt !== undefined
  return (
    <button
      ref={button}
      type="button"
      className={`${className}${armed ? ' is-armed' : ''}`}
      title={armed ? armedLabel : title}
      aria-label={armed ? armedLabel : ariaLabel}
      disabled={disabled}
      onBlur={() => setArmedAt(undefined)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && armed) {
          event.stopPropagation()
          setArmedAt(undefined)
        }
      }}
      onClick={() => {
        if (!armed) {
          setArmedAt(now())
          return
        }
        // The second click of a double-click is not a second decision.
        if (now() - armedAt < SETTLE_MS) return
        setArmedAt(undefined)
        onConfirm()
      }}
    >
      {armed ? armedLabel : children}
    </button>
  )
}
