import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { BEND, MetalFx, setBendConfig, useMetalBend } from 'metal-fx'

import { METAL_STRENGTHS, metalBendConfig } from '../metal.js'
import type { MetalMotion, MetalPreset, MetalStrength } from '../../../shared/ipc.js'

/**
 * The bend, mounted on the element the library actually deforms.
 *
 * **`setBendConfig` alone does nothing** — that was the defect Colin found by
 * looking ("i dont think the cursor bend is working", 2026-09-20). It writes a
 * mutable singleton; the singleton is only ever read by `useMetalBend`, and
 * nothing called it. The configuration was correct and unused.
 *
 * Two things the hook is strict about, both read out of its source rather than
 * guessed:
 *
 *   1. **The ref must be `.metal-fx-root` itself, not a wrapper.** It measures
 *      `getBoundingClientRect()`, reads `getComputedStyle(n, '::after')` for
 *      the ring's rim, and takes over `n.style.filter`. Our host is
 *      `display: contents`, so it has no box at all — handing that over would
 *      have produced a zero-size field and no visible dent even once the hook
 *      was being called.
 *   2. **Its effect depends on the ref OBJECT.** A ref filled in later never
 *      re-runs it, and at our first paint the root does not exist yet. So the
 *      ref is `useMemo`'d on the node: a new node means a new object, which
 *      means the hook re-arms. This component mounts only once the node has
 *      been found, so its first run already has something to measure.
 */
/**
 * The config getter, declared ONCE at module scope, and that is load-bearing.
 *
 * `useMetalBend(ref, getCfg = () => BEND)` keys its effect on `[ref, getCfg]`,
 * and a DEFAULT PARAMETER is a fresh closure on every call — so calling the
 * hook with one argument re-arms it on every render of this component, and
 * every teardown runs the library's own cleanup, which removes the
 * deformation. At one render per hover nobody noticed. Adding a second piece
 * of state was enough for the teardown to land on top of the dent, and the
 * drive went red on a feature that had worked ten minutes earlier.
 *
 * A stable reference means the effect arms once and stays armed.
 */
const bendConfig = (): typeof BEND => BEND

function MetalBend({ node }: { readonly node: HTMLElement | null }): null {
  const ref = useMemo(() => ({ current: node }), [node])
  useMetalBend(ref, bendConfig)
  return null
}

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
  preset = 'silver',
  strength = 'standard',
  motion = 'hover',
  bend = true,
  innerShadow = false,
  reflectionTargets,
  ...button
}: {
  readonly children: ReactNode
  /** A rim of light along the ring's top inside edge, as the page's composer draws it. */
  readonly innerShadow?: boolean
  /** The chips the metal is cast onto -- the page casts it onto the chip beside the send. */
  readonly reflectionTargets?: ReadonlyArray<RefObject<HTMLElement | null>>
  /** `off` renders the plain button and mounts no shader at all. */
  readonly preset?: MetalPreset
  readonly strength?: MetalStrength
  readonly motion?: MetalMotion
  readonly bend?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  /*
   * HOVER AND FOCUS ARE TRACKED APART, and they used to be one flag.
   *
   * They are woken by the same thing and put back to sleep by different
   * things: a pointer can leave without an event, a focus cannot. One shared
   * flag meant the pointer's rescue below would also have stolen the metal
   * out from under somebody tabbing through the composer.
   */
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const awake = hover || focused
  /** False until the shader has painted once; see finding 1. */
  const [warm, setWarm] = useState(false)
  /** The library's own root, once it exists. The bend deforms this. */
  const [painted, setPainted] = useState<HTMLElement | null>(null)
  /**
   * Frozen, which is NOT the same as asleep, and conflating them is what put
   * a halo on an idle screen.
   *
   * Colin, 2026-09-20: "the 'glow' halo effect is staying even after hover,
   * its not moving but its still glowing." Exactly right, and the second half
   * is the diagnosis. `paused` freezes the instance on its CURRENT FRAME —
   * the library's own words — and the current frame at the moment a pointer
   * leaves is the lit one. So the shimmer stopped and the halo it had been
   * wearing stayed, which is the worst of both: no motion to justify it and
   * no way for it to leave.
   *
   * The halo has its own knob, `glowGain`, and the fix is to turn it down
   * BEFORE the freeze rather than freeze on top of it — hence a delay. A
   * composite has to run once at the new gain for the glow to be redrawn
   * without it, and while paused the only composites are incidental ones. So
   * sleeping now means: glow to zero, keep running a moment, then freeze on a
   * frame that has no halo in it.
   */
  const [frozen, setFrozen] = useState(false)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    /*
     * The bend's numbers — the "gooey" part. A mutable singleton the library
     * reads every frame, so it is set once for the app rather than per
     * instance. It is INERT on its own: `MetalBend` above is what reads it.
     * `applyTo: 'ring'` keeps the arrow rigid — denting the icon would make
     * the control feel unreliable at the exact moment it is being pressed.
     */
    setBendConfig(metalBendConfig(bend, METAL_STRENGTHS[strength]))
  }, [bend, strength])

  useEffect(() => {
    if (warm) return
    const node = host.current
    if (node === null) return
    /*
     * Watch for the library's own reveal rather than guessing a delay. A
     * 700ms guess loses the race on a cold shader compile, and losing it
     * means pausing an instance that never painted — invisible forever.
     */
    let live = true
    const look = (): void => {
      if (!live) return
      const root = node.querySelector<HTMLElement>('.metal-fx-root')
      if (root !== null) {
        setPainted(root)
        if (root.style.opacity === '1') {
          setWarm(true)
          return
        }
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    return () => {
      live = false
    }
  }, [warm])

  /*
   * A DISABLED BUTTON NEVER SAYS GOODBYE.
   *
   * Colin, 2026-09-20: "the glow doesnt disappear after hover sometimes."
   * Press send with the cursor still on it and the button disables under the
   * pointer — `pointerleave` is a pointer event, a disabled control gets
   * none, so the last thing this component ever heard was `pointerenter`, and
   * the shader kept running over an empty composer. Which is the precise
   * thing hover-only metal exists to avoid: motion claiming work that is not
   * happening.
   */
  const disabled = button.disabled === true
  useEffect(() => {
    if (disabled) setHover(false)
  }, [disabled])

  useEffect(() => {
    if (awake) {
      setFrozen(false)
      return
    }
    /*
     * 240ms, and the number is the shared loop's, not a taste call: it
     * composites at 15fps, so a frame is ~66ms and two rAFs would not have
     * been enough to guarantee even one. This buys three or four, which is
     * certainly enough for the glow to be redrawn at zero — and it reads as
     * the halo fading out behind the cursor rather than being switched off,
     * which is the nicer of the two anyway.
     */
    const id = setTimeout(() => setFrozen(true), 240)
    return () => clearTimeout(id)
  }, [awake])

  useEffect(() => {
    if (!hover) return
    const node = host.current
    /*
     * The general case of the same failure: any way a pointer can end up off
     * this button without the button hearing about it — a re-render under the
     * cursor, a window that loses focus, a pointer that leaves the window
     * entirely. Armed only while awake, so it costs nothing at rest.
     */
    const elsewhere = (event: PointerEvent): void => {
      const target = event.target
      if (node !== null && target instanceof Node && node.contains(target)) return
      setHover(false)
    }
    const sleep = (): void => setHover(false)
    document.addEventListener('pointerover', elsewhere, { passive: true })
    document.addEventListener('pointerleave', sleep)
    window.addEventListener('blur', sleep)
    return () => {
      document.removeEventListener('pointerover', elsewhere)
      document.removeEventListener('pointerleave', sleep)
      window.removeEventListener('blur', sleep)
    }
  }, [hover])

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
      ref={host}
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
      /* The third of those: "we asked for the bend and found something to bend". */
      data-bend={bend && painted !== null ? 'true' : 'false'}
    >
      {bend ? <MetalBend node={painted} /> : null}
      <MetalFx
        variant="circle"
        {...(innerShadow ? { innerShadow: true } : {})}
        {...(reflectionTargets === undefined ? {} : { reflectionTargets })}
        preset={preset}
        strength={METAL_STRENGTHS[strength]}
        // Pinned, not `auto`: `auto` falls back to the OS setting and Locust
        // is dark regardless, so a light desktop would get dark metal.
        theme="dark"
        /*
         * THE HALO IS THE HOVER, and the ring is the button.
         *
         * `glowGain` multiplies the halo and catch-light only, leaving the
         * metal silhouette alone — so at rest the control still looks like
         * metal, and the glow becomes the part that actually answers a
         * person. That is a better division than the one we had: a halo
         * sitting on an idle screen was making the same claim a shimmer
         * would, which is the thing hover-only metal exists to avoid.
         */
        glowGain={motion === 'always' || awake ? 1 : 0}
        // `always` is the version the design agent asked to reject, kept so
        // the rejection can be agreed with after seeing it rather than before.
        paused={motion === 'always' ? false : warm ? frozen : false}
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
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          {children}
        </button>
      </MetalFx>
    </div>
  )
}
