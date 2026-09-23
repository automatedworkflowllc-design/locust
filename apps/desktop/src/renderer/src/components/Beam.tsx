import type { ReactElement, ReactNode } from 'react'
import { BorderBeam } from 'border-beam'

/**
 * A BEAM: libraries.dev's border beam, in Locust's one setting -- mono.
 *
 * Colin, 2026-09-23, on https://libraries.dev/beam: *"they have a loading hue
 * for their stop button lets just use that asset but make it mono instead to
 * make it subtle"*, and *"lets add a rotate large mono around the title box
 * with the logo in it"*. So every beam here is grey light travelling the
 * border (`colorVariant="mono"`, no hue shift), on the dark theme; `sm` for a
 * button, `md` -- the playground's "Large" -- for a card.
 *
 * A travelling light is motion, so it follows the rule the rest of the app
 * keeps: none when the system asks for reduced motion (the package promises
 * that only for its pulse types). And it is a signal, not wallpaper: callers
 * turn it off whenever what it marks is not happening.
 */

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function Beam({
  children,
  size,
  active = true,
  strength,
  className
}: {
  readonly children: ReactNode
  readonly size: 'sm' | 'md'
  readonly active?: boolean
  /** 0-1, the beam's opacity; the content is untouched. */
  readonly strength?: number
  readonly className?: string
}): ReactElement {
  return (
    <BorderBeam
      size={size}
      colorVariant="mono"
      theme="dark"
      staticColors
      active={active && !reducedMotion()}
      {...(strength === undefined ? {} : { strength })}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </BorderBeam>
  )
}
