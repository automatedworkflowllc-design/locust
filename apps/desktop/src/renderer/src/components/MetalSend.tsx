import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { MetalFx, setBendConfig } from 'metal-fx'

import { METAL_STRENGTHS, metalBendConfig } from '../metal.js'
import type { MetalMotion, MetalPreset, MetalStrength } from '../../../shared/ipc.js'

/**
 * The send button, in metal, but only while a person is on it.
 *
 * **Why not at rest** (design agent, 2026-09-20): the shader never stops, and
 * in this app motion means work is happening. A permanently shimmering send
 * button says "running" on a screen where nothing is — the same category
 * error as five rows reading CHECKING. A signal that never varies is not a
 * signal.
 *
 * **Why on hover**: motion becomes a response to the PERSON rather than a
 * claim about the machine, which is a category this app did not have. The
 * send button is the one control that is an invitation rather than a state.
 *
 * **The keyboard half is not optional.** `:focus-visible` too, because a
 * hover-only flourish is a reward for owning a mouse and the composer is the
 * one place this app expects people to live on the keyboard.
 *
 * THREE INTEGRATION FINDINGS, all the design agent's, all paid for already:
 *
 *   1. **Never mount paused.** `MetalFx` reveals on its first shader copy and
 *      a paused instance never makes one — so `paused` at mount is not
 *      "frozen at rest", it is invisible forever, and unpausing later does
 *      not recover it. This mounts unpaused and pauses after the first frame.
 *   2. **An unstable ref starves it.** A ref callback rebuilt each render
 *      makes React dispose and remount the instance every time, and a cold
 *      shader never survives the round trip. Everything here is either state
 *      or a stable ref.
 *   3. **Wrap the control, do not overlay it.** The canvas is opaque across
 *      the interior, so an overlay blanks the label while a hit test still
 *      "proves" the button is on top. `MetalFx` layers content above the
 *      canvas by design, so the button is built inside its tree and this host
 *      has no children of its own.
 */
export function MetalSend({
  children,
  preset = 'chromatic',
  strength = 'subtle',
  motion = 'hover',
  bend = true,
  ...button
}: {
  readonly children: ReactNode
  /** `off` renders the plain button and mounts no shader at all. */
  readonly preset?: MetalPreset
  readonly strength?: MetalStrength
  readonly motion?: MetalMotion
  readonly bend?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  const [awake, setAwake] = useState(false)
  /** False until the shader has painted once; see finding 1. */
  const [warm, setWarm] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    /*
     * The bend — the "gooey" part. A mutable singleton the library reads
     * every frame, so it is set once for the app rather than per instance.
     * `applyTo: 'ring'` keeps the arrow rigid: denting the icon would make
     * the control feel unreliable at the exact moment it is being pressed.
     */
    setBendConfig(metalBendConfig(bend, METAL_STRENGTHS[strength]))
  }, [bend, strength])

  useEffect(() => {
    if (warm) return
    const node = root.current
    if (node === null) return
    /*
     * Watch for the library's own reveal rather than guessing a delay. A
     * 700ms guess loses the race on a cold shader compile, and losing it
     * means pausing an instance that never painted — invisible forever.
     */
    let live = true
    const look = (): void => {
      if (!live) return
      const painted = node.querySelector<HTMLElement>('.metal-fx-root')
      if (painted !== null && painted.style.opacity === '1') {
        setWarm(true)
        return
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    return () => {
      live = false
    }
  }, [warm])

  /*
   * OFF MEANS NO SHADER AT ALL, not a paused one.
   *
   * A paused instance still mounts a canvas, compiles a program and holds a
   * WebGL context — which is exactly what somebody choosing `off` on a tired
   * machine is asking to avoid. It is also the safest possible fallback for
   * the failure the design agent warned about: a plain button cannot be
   * invisible.
   */
  if (preset === 'off') return <button {...button}>{children}</button>

  return (
    <div
      ref={root}
      className="lc-metalsend"
      /*
       * A seam, the way `data-register` is one on the live step: it says what
       * this component THINKS, so a drive can tell "the pointer never reached
       * us" apart from "we knew and the shader ignored us". Those two look
       * identical from outside and cost a round of guessing when they were
       * not separable.
       */
      data-awake={awake ? 'true' : 'false'}
      data-warm={warm ? 'true' : 'false'}
    >
      <MetalFx
        variant="circle"
        preset={preset}
        strength={METAL_STRENGTHS[strength]}
        // Pinned, not `auto`: `auto` falls back to the OS setting and Locust
        // is dark regardless, so a light desktop would get dark metal.
        theme="dark"
        // `always` is the version the design agent asked to reject, kept so
        // the rejection can be agreed with after seeing it rather than before.
        paused={motion === 'always' ? false : warm ? !awake : false}
      >
        {/*
          * THE HANDLERS BELONG ON THE BUTTON, not on the wrapper above it.
          *
          * The wrapper is `display: contents` so it does not become a second
          * layout participant in the composer's tight button row — which
          * means it has no box, and an element with no box is the wrong thing
          * to ask about the pointer. Driven at 1280x860 with a real CDP mouse
          * move onto the button's own centre, the wrapper's `pointerenter`
          * never fired and the shader stayed asleep under the cursor.
          *
          * The button has a real box and is the thing a person is actually
          * pointing at, so it answers.
          */}
        <button
          {...button}
          onPointerEnter={() => setAwake(true)}
          onPointerLeave={() => setAwake(false)}
          onFocus={() => setAwake(true)}
          onBlur={() => setAwake(false)}
        >
          {children}
        </button>
      </MetalFx>
    </div>
  )
}
