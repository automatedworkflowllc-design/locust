import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

import type { BotAvatarState } from 'bot-avatars'

import type { TeammateHue, TubePreference } from '../../../shared/ipc.js'
import { Beam } from './Beam.js'
import { Bot } from './Bot.js'
import type { BotType } from './Bot.js'
import { PoweredLockup } from './PoweredLockup.js'

/**
 * THE DESIGN SYSTEM'S COVER, ON THE HOME SCREEN.
 *
 * 0.270 put only the cover's lockup here, and Colin, looking at it: *"it can
 * be a 1:1 once you fix the text description under locust tbh ... cause right
 * now it just looks like the locust logo and crt shipped"*. So this is the
 * whole cover: the lockup lighting up with the claim centred under it, and
 * three teammates on their plate, each in a real state.
 *
 * THE TEAMMATES ARE BOTS (0.274). Colin, on libraries.dev/bots: *"this is
 * actually fucking perfect brother"*, then *"we will unfortunately have to
 * update the title screen as well, lets definitely include ghost in there"*.
 * Wren is a ghost, working; Atlas a droid, waiting on you (Locust's amber
 * ring and dot); Sable a Locust of our own, the Hopper, asleep. They follow a
 * pointer that comes near, and hop when clicked.
 *
 * ONE DRAWING, TO SCALE. Every number below is the cover's own, on its own
 * 960x288 canvas, and the card draws it at the column's width: the column is
 * 760 to 980px wide, so the card is the cover at 0.79 to 1.02 of its size
 * rather than a rearrangement of it. Bots are sized in whole pixels at that
 * scale.
 *
 * The bots wake with the lockup: still, with no presence dot, until the
 * runtimes have answered -- the moment the loading screen's work is done and
 * the cover comes on.
 *
 * AND THE SCREEN NOTICES YOU (0.300). Colin's "have fun" list, 2026-09-23 --
 * "you can run all those": the sleeping Hopper opens its eyes and watches a
 * pointer that comes near, and dozes off again once it has gone; a click on
 * the glass powers the lockup on again; turning swarm on sends a few small
 * swarm bots up across the screen, once.
 */

/** The cover's canvas, in its own units. Everything is placed on it. */
export const COVER_WIDTH = 960
export const COVER_HEIGHT = 254

/** The narrowest reading column, and so the scale the card starts at before it is measured. */
const FIRST_SCALE = 760 / COVER_WIDTH

/**
 * HOW MUCH THE DRAWING MAY GROW INTO SPARE HEIGHT.
 *
 * Colin, 2026-09-26, on Home at a large window: "theres lots of dead space,
 * might need to make logo bigger". The card takes the column's width, and the
 * column stops at 980px, so on a tall window the cover stayed its width's size
 * and every extra pixel of height was empty space above it. The DRAWING only
 * spans the middle of its canvas -- the machine is 560 of 960 units wide, the
 * three bots stand on it -- so it can grow about its centre without the card,
 * or the column the composer shares, moving at all.
 *
 * Two limits, both measured rather than guessed: the drawing keeps 3% of the
 * card clear on each side (`coverWidthGrow`), and it grows at most 1.45x --
 * past that the machine stops reading as an object on the page and starts
 * reading as the page.
 */
export const COVER_MAX_GROW = 1.45

/**
 * AND HOW MUCH IT MAY GIVE BACK WHEN THE PAGE IS SHORT (0.401).
 *
 * A new person's Home at 1440x900 -- the three team templates and seven
 * runtimes under the cover -- was 66px taller than its pane. The pane keeps
 * to its end (FirstLaunch), so those 66px came off the top: the air above
 * the cover, then the cover's own top, and the mascots stood cut off by the
 * title bar on the first screen a person sees (drive-signed-out). The
 * drawing now gives back height the way it takes it, about its centre, down
 * to this. The floor is the claim's: it stops at 10.5px so it stays
 * readable, and the glass keeps shrinking -- at 0.75 the claim ran from edge
 * to edge of the glass (drive-signed-out measures the margin). A page still
 * too tall scrolls as before.
 */
export const COVER_MIN_GROW = 0.85

/** The most the drawing can grow and keep 3% of the card clear each side. Read from the machine, which is the drawing's widest part. */
function coverWidthGrow(): number {
  return (0.94 * COVER_WIDTH) / COVER_MACHINE.width
}

/** The grow factor for this much spare height above a cover of this height; short of room, below 1. */
export function coverGrowFor(room: number, baseHeight: number): number {
  if (!Number.isFinite(room) || !Number.isFinite(baseHeight) || baseHeight <= 0 || room === 0) return 1
  if (room < 0) return Math.round(Math.max(COVER_MIN_GROW, 1 + room / baseHeight) * 1000) / 1000
  return Math.round(Math.min(COVER_MAX_GROW, coverWidthGrow(), 1 + room / baseHeight) * 1000) / 1000
}

/** The cover drawn to fit a card this many pixels wide. */
export function coverScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return Math.round(FIRST_SCALE * 1000) / 1000
  return Math.round((width / COVER_WIDTH) * 1000) / 1000
}

interface CoverBot {
  readonly key: string
  readonly type: BotType
  /** A teammate hue, or none for the shape's own colour (the ghost's white). */
  readonly hue?: TeammateHue
  readonly state: BotAvatarState
  /** Floats instead of hopping: a slow bob, no idle jumps. */
  readonly floats?: boolean
  /** Locust's own marks: the presence dot, and the ring of a teammate waiting on you. */
  readonly dot?: 'lime' | 'amber'
  readonly waiting?: boolean
  /** Top-left on the cover's canvas, where a bot is 120 across. */
  readonly x: number
  readonly y: number
}

/**
 * The cover's cast. Colin, 2026-09-22: *"maybe make the ghost white and the
 * locust green lol"*, and of the ghost's working hops and spins: *"a little
 * loud for a title screen, especially for a ghost"* -- so it floats: the
 * library's idle look-around with no jumps, carried on a slow bob.
 */
export const COVER_CAST: readonly CoverBot[] = [
  { key: 'wren', type: 'ghost', state: 'default', floats: true, dot: 'lime', x: 245, y: -10 },
  { key: 'atlas', type: 'droid', hue: 'blue', state: 'default', dot: 'amber', waiting: true, x: 432, y: 0 },
  { key: 'sable', type: 'hopper', hue: 'lime', state: 'sleeping', x: 619, y: -2 }
]

/*
 * THE MACHINE (A2). His words,
 * 2026-09-23: "the title screen with border around logo and text,
 * teammates on top of logo, this would give it a more centered look, give
 * the locust logo and text have something to actually run the crt effect,
 * and the teammates could have a structure to be on top of, the border, crt
 * effect, would almost make it look like a machine as well so the text
 * under it would have a cooler meaning". So: the boot screen's own bezel and
 * glass, small, centred on the cover; the lockup lights INSIDE the glass;
 * the three stand on the bezel's top edge; the claim is its label.
 */
export const COVER_MACHINE = { x: 200, y: 86, width: 560, height: 162 } as const
/*
 * Colin, looking at the sample: "Let's make the screen bigger and put the
 * text in it as well". So the claim is on the glass under the lockup, where
 * the tube runs over it too, and the screen took the height the label under
 * it had used -- the cover stays 254 tall, so the first screen still fits at
 * 1120x720 (first-screen-fits.mjs, B11).
 */

/**
 * A teammate hue as a colour a canvas can take: the token's own value, read
 * off the page, so the palette still has one definition (tokens.css). Nothing
 * to read before there is a page; the bot then wears its own colour.
 */
function hueColor(hue: TeammateHue): string | undefined {
  if (typeof document === 'undefined') return undefined
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--lc-hue-${hue}`).trim()
  return value.length === 0 ? undefined : value
}

const FACE = 96

/** The one asleep on the cover, who wakes for a pointer. */
const SLEEPER = 'sable'

/** How near a pointer wakes the Hopper, in its own widths from the middle of it. */
export const WAKE_WITHIN = 1.6

/** How long the pointer has to have been gone before it dozes off again. */
export const DOZE_AFTER_MS = 4_000

/**
 * A home screen nobody has touched for this long rests, as it does behind
 * other windows: its bots drawn still, the ghost's float and the waiting ring
 * held. The next pointer, key or wheel wakes it.
 */
export const REST_AFTER_MS = 30_000

export interface Wakefulness {
  readonly awake: boolean
  /** When the pointer went, while it is still awake; undefined while the pointer is near. */
  readonly awaySince: number | undefined
}

export const ASLEEP: Wakefulness = { awake: false, awaySince: undefined }

/**
 * The Hopper, one reading of the pointer later: awake while it is near,
 * awake still for DOZE_AFTER_MS after it goes, then asleep. `distance` is in
 * the Hopper's widths, undefined when there is no pointer (it left the
 * window). The same value back when nothing changed, so a pointer moving
 * far away costs no render.
 */
export function hopperWakes(held: Wakefulness, distance: number | undefined, now: number): Wakefulness {
  if (distance !== undefined && distance <= WAKE_WITHIN) {
    return held.awake && held.awaySince === undefined ? held : { awake: true, awaySince: undefined }
  }
  if (!held.awake) return held
  const since = held.awaySince ?? now
  if (now - since >= DOZE_AFTER_MS) return ASLEEP
  return held.awaySince === since ? held : { awake: true, awaySince: since }
}

/** How far a point is from the middle of a box, in the box's widths. */
export function widthsFrom(
  box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  x: number,
  y: number
): number {
  return Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2)) / (box.width || 1)
}

/**
 * ONE SWARM FLIGHT: where a small swarm bot comes from and goes, on the
 * cover's own canvas, how big it is, and when. The swarm bot is the mark in
 * flight seen from above, head up, so each climbs up and to the right and
 * leans into its heading -- out of the lower left, over the machine and
 * behind the three standing on it, and off the top.
 */
export interface SwarmFlight {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly size: number
  readonly delay: number
  readonly duration: number
  /** How far it weaves off its line, either side. */
  readonly sway: number
}

export const SWARM_FLIGHTS: readonly SwarmFlight[] = [
  { x0: 150, y0: 262, x1: 470, y1: -90, size: 26, delay: 0, duration: 2300, sway: 10 },
  { x0: 250, y0: 280, x1: 590, y1: -70, size: 22, delay: 120, duration: 2500, sway: -8 },
  { x0: 60, y0: 250, x1: 380, y1: -100, size: 30, delay: 260, duration: 2200, sway: 12 },
  { x0: 330, y0: 270, x1: 700, y1: -80, size: 24, delay: 380, duration: 2600, sway: -10 },
  { x0: 190, y0: 300, x1: 540, y1: -60, size: 20, delay: 520, duration: 2400, sway: 8 },
  { x0: 420, y0: 265, x1: 800, y1: -95, size: 28, delay: 640, duration: 2350, sway: -12 },
  { x0: 100, y0: 290, x1: 430, y1: -85, size: 22, delay: 780, duration: 2550, sway: 9 }
]

/** The whole flight, first take-off to the last one gone. */
export const SWARM_MS = Math.max(...SWARM_FLIGHTS.map((flight) => flight.delay + flight.duration))

/** Degrees clockwise from straight up: the way a flight is heading. */
export function headingOf(flight: SwarmFlight): number {
  return Math.round((Math.atan2(flight.x1 - flight.x0, flight.y0 - flight.y1) * 180) / Math.PI)
}

/**
 * A flight's keyframes on a cover drawn at `scale`: along its line with a
 * weave, fading in as it leaves and out as it goes.
 */
export function flightFrames(flight: SwarmFlight, scale: number): Keyframe[] {
  const dx = flight.x1 - flight.x0
  const dy = flight.y1 - flight.y0
  const length = Math.hypot(dx, dy) || 1
  const heading = headingOf(flight)
  return [
    { offset: 0, opacity: 0 },
    { offset: 0.12, opacity: 1 },
    { offset: 0.5, opacity: 1 },
    { offset: 0.85, opacity: 1 },
    { offset: 1, opacity: 0 }
  ].map((frame) => {
    const weave = flight.sway * Math.sin(2 * Math.PI * frame.offset)
    const x = flight.x0 + dx * frame.offset + (-dy / length) * weave - flight.size / 2
    const y = flight.y0 + dy * frame.offset + (dx / length) * weave - flight.size / 2
    return {
      offset: frame.offset,
      opacity: frame.opacity,
      transform: `translate(${String(Math.round(x * scale))}px, ${String(Math.round(y * scale))}px) rotate(${String(heading)}deg)`
    }
  })
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** The swarm, once: every flight, then it tells the cover it has gone. */
function SwarmRun({ scale, originX = 0, onGone }: { readonly scale: number; readonly originX?: number; readonly onGone: () => void }): ReactElement {
  const flyers = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const running: Animation[] = []
    for (const [index, flight] of SWARM_FLIGHTS.entries()) {
      const element = flyers.current[index]
      if (element === null || element === undefined || typeof element.animate !== 'function') continue
      running.push(
        element.animate(flightFrames(flight, scale), {
          duration: flight.duration,
          delay: flight.delay,
          easing: 'cubic-bezier(0.3, 0.05, 0.5, 1)',
          fill: 'both'
        })
      )
    }
    if (running.length === 0) {
      onGone()
      return undefined
    }
    let flying = running.length
    for (const animation of running) {
      animation.onfinish = () => {
        flying -= 1
        if (flying === 0) onGone()
      }
    }
    return () => {
      for (const animation of running) animation.cancel()
    }
    // One run per mount: the cover gives each run its own key.
  }, [])
  return (
    <span className="lc-cover__swarm" aria-hidden="true" style={originX === 0 ? undefined : { transform: `translateX(${String(originX)}px)` }}>
      {SWARM_FLIGHTS.map((flight, index) => (
        <span
          key={index}
          className="lc-cover__flyer"
          ref={(node) => {
            flyers.current[index] = node
          }}
          style={{ width: Math.round(flight.size * scale), height: Math.round(flight.size * scale) }}
        >
          <Bot type="swarm" size={Math.round(flight.size * scale)} state="default" jumpEvery={0} seed={0.11 + index * 0.13} />
        </span>
      ))}
    </span>
  )
}

export function HomeCover({
  ready,
  tube,
  swarmCalls = 0,
  grow = 1
}: {
  /** The runtimes have answered: the loading screen's work is done. */
  readonly ready: boolean
  readonly tube: TubePreference
  /** How many times swarm has been turned on this session: each new one flies the swarm across. */
  readonly swarmCalls?: number
  /** Spare height the page gives the drawing, as a factor (`coverGrowFor`). */
  readonly grow?: number
}): ReactElement {
  const card = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(() => coverScale(0))
  const faces = useRef(new Map<string, HTMLSpanElement>())
  const [sleeper, setSleeper] = useState<Wakefulness>(ASLEEP)
  const [relights, setRelights] = useState(0)
  /*
   * Only a swarm turned on while the cover is up flies. The count the cover
   * came up with is the past -- swarm turned on in a conversation, or before
   * this screen was shown -- and flying it now would say something had just
   * happened that had not.
   */
  const swarmSeen = useRef(swarmCalls)
  const [swarmRun, setSwarmRun] = useState<number>()
  useEffect(() => {
    if (swarmCalls === swarmSeen.current) return
    swarmSeen.current = swarmCalls
    if (!reducedMotion()) setSwarmRun(swarmCalls)
  }, [swarmCalls])
  const swarmGone = useCallback(() => setSwarmRun(undefined), [])
  /*
   * RESTING WHILE NOBODY IS LOOKING. The three move on every frame, and
   * plastic is lit per pixel: measured on the built app, about 11% of the
   * renderer while the home screen is up. A home screen left open behind
   * other work was paying that for no one. So they rest while the window is
   * in the background and pick up again when it comes back; a hidden window
   * already stops them.
   */
  const [focused, setFocused] = useState(() => typeof document === 'undefined' || document.hasFocus())
  useEffect(() => {
    const wake = (): void => setFocused(true)
    const rest = (): void => setFocused(false)
    window.addEventListener('focus', wake)
    window.addEventListener('blur', rest)
    // The window is shown, and focused, as the app loads: a focus that lands
    // between the first render and these listeners is missed by both, and
    // the loading beam would wait for the next one. Read it now instead.
    setFocused(document.hasFocus())
    return () => {
      window.removeEventListener('focus', wake)
      window.removeEventListener('blur', rest)
    }
  }, [])
  /*
   * ...AND WHILE NOBODY IS TOUCHING IT (0.305). A beta tester: "Lowkey my
   * computer feels noticeably slower while running locust". Measured on
   * 0.302, the home screen IN FRONT cost 39.6% of one core, for as long as it
   * was up, whether anyone was there or not. So the cover also rests once no
   * pointer, key or wheel has touched the window for REST_AFTER_MS. A move
   * that lands while it is awake only notes the time: nothing re-renders.
   */
  const [touched, setTouched] = useState(true)
  useEffect(() => {
    let lastTouch = performance.now()
    let timer: number | undefined
    const check = (): void => {
      const idle = performance.now() - lastTouch
      if (idle >= REST_AFTER_MS) {
        timer = undefined
        setTouched(false)
      } else {
        timer = window.setTimeout(check, REST_AFTER_MS - idle + 50)
      }
    }
    const touch = (): void => {
      lastTouch = performance.now()
      if (timer === undefined) {
        setTouched(true)
        timer = window.setTimeout(check, REST_AFTER_MS + 50)
      }
    }
    timer = window.setTimeout(check, REST_AFTER_MS + 50)
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focus'] as const
    for (const name of events) window.addEventListener(name, touch, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const name of events) window.removeEventListener(name, touch)
    }
  }, [])
  const awake = focused && touched

  /*
   * THE HOPPER WAKES FOR A POINTER. It sleeps on the machine until a pointer
   * comes within WAKE_WITHIN of it, opens its eyes and follows it (every bot
   * on the cover follows a pointer that comes near), and dozes off again
   * DOZE_AFTER_MS after the pointer has gone. Only once the cover is on.
   */
  useEffect(() => {
    if (!ready) return undefined
    const read = (x: number | undefined, y: number | undefined): void => {
      const face = faces.current.get(SLEEPER)
      const distance = face === undefined || x === undefined || y === undefined ? undefined : widthsFrom(face.getBoundingClientRect(), x, y)
      setSleeper((held) => hopperWakes(held, distance, performance.now()))
    }
    const moved = (event: PointerEvent): void => read(event.clientX, event.clientY)
    const gone = (): void => read(undefined, undefined)
    window.addEventListener('pointermove', moved, { passive: true })
    document.addEventListener('pointerleave', gone)
    window.addEventListener('blur', gone)
    return () => {
      window.removeEventListener('pointermove', moved)
      document.removeEventListener('pointerleave', gone)
      window.removeEventListener('blur', gone)
    }
  }, [ready])
  // Dozing off needs no pointer: it comes once the pointer has been gone long enough.
  useEffect(() => {
    if (!sleeper.awake || sleeper.awaySince === undefined) return undefined
    const left = DOZE_AFTER_MS - (performance.now() - sleeper.awaySince)
    const timer = window.setTimeout(() => setSleeper((held) => hopperWakes(held, undefined, performance.now())), Math.max(0, left) + 20)
    return () => window.clearTimeout(timer)
  }, [sleeper])

  useEffect(() => {
    const element = card.current
    if (element === null) return undefined
    const measure = (): void => setScale(coverScale(element.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // `scale` fits the canvas to the card; `drawn` is that grown by the room
  // the page gives (`grow`), about the canvas's centre -- so `left` is offset
  // by half of what the canvas outgrew, and the drawing stays centred on a
  // card that did not move.
  const drawn = Math.round(scale * Math.min(Math.max(COVER_MIN_GROW, grow), COVER_MAX_GROW, coverWidthGrow()) * 1000) / 1000
  const originX = Math.round((scale - drawn) * COVER_WIDTH / 2)
  const at = (value: number): number => Math.round(value * drawn)
  const atX = (value: number): number => originX + at(value)
  return (
    /*
     * A mono beam goes round the title box WHILE THE RUNTIMES ARE BEING
     * FOUND, and goes out as the lockup lights and the bots wake.
     *
     * Colin asked for it (2026-09-23: "a rotate large mono around the title
     * box with the logo in it"), and 0.278 ran it for as long as the home
     * screen was up. Then, having looked at it: "it just makes it look like
     * something is loading that isnt loading ... it just drags away your
     * eyes from all the other movement on screen". Both true, and the same
     * fact: a travelling light reads as loading. So it is shown exactly when
     * something IS loading -- before the bots move, never beside them. It
     * does not wait for the window's focus as the bots do: loading is a few
     * seconds, and a window that is still being shown may not have it yet.
     */
      <div className="lc-cover lc-cover--machine" ref={card} style={{ '--lc-cover-k': String(drawn) } as CSSProperties}>
        <div
          className="lc-cover__machineslot"
          style={{ left: atX(COVER_MACHINE.x), top: at(COVER_MACHINE.y), width: at(COVER_MACHINE.width), height: at(COVER_MACHINE.height) }}
        >
          <Beam size="md" strength={0.85} active={!ready} className="lc-coverbeam lc-coverbeam--machine">
            <div className="lc-cover__machine">
              {/* A click on the glass powers the lockup on again (PoweredLockup's `replay`). */}
              <div className="lc-cover__glass" onClick={ready ? () => setRelights((count) => count + 1) : undefined}>
                <span className="lc-cover__scan" aria-hidden="true" />
                <div className="lc-cover__screen">
                  <PoweredLockup ready={ready} tube={tube} replay={relights} resting={!awake} />
                  <p className="lc-cover__claim">Autonomous teammates on your own machine</p>
                </div>
              </div>
            </div>
          </Beam>
        </div>
        {swarmRun !== undefined && <SwarmRun key={swarmRun} scale={drawn} originX={originX} onGone={swarmGone} />}
        {COVER_CAST.map((mate, index) => {
          const size = at(FACE)
          const color = mate.hue === undefined ? undefined : hueColor(mate.hue)
          const state = mate.key === SLEEPER && sleeper.awake ? 'default' : mate.state
          return (
            <span key={mate.key} className="lc-cover__face" style={{ left: atX(mate.x), top: at(mate.y) }}>
              <span
                className={`lc-bot${ready && mate.floats === true ? ' is-floating' : ''}${ready && !awake ? ' is-resting' : ''}`}
                data-bot={mate.type}
                data-state={ready ? state : 'still'}
                style={{ width: size, height: size }}
                ref={(node) => {
                  if (node === null) faces.current.delete(mate.key)
                  else faces.current.set(mate.key, node)
                }}
              >
                {ready && mate.waiting === true && <span className="lc-bot__ring" />}
                <Bot
                  type={mate.type}
                  size={size}
                  state={ready ? state : 'default'}
                  paused={!ready || !awake}
                  interactive
                  seed={0.2 + index * 0.3}
                  {...(mate.floats === true ? { jumpEvery: 0 } : {})}
                  {...(color === undefined ? {} : { color })}
                />
                {ready && mate.dot !== undefined && (
                  <span className={`lc-presence lc-presence--${mate.dot}`} style={{ width: Math.max(8, Math.round(size * 0.08)), height: Math.max(8, Math.round(size * 0.08)) }} />
                )}
              </span>
            </span>
          )
        })}
      </div>
  )
}
