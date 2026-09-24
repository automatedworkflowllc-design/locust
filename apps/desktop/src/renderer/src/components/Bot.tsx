import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import {
  BOT_AVATAR_OVERSCAN,
  BOT_AVATAR_RISE,
  BotAvatarSim,
  autoInk,
  botAvatarJumpDefaults,
  botAvatarPalette,
  botAvatarParts,
  botAvatarPresets,
  botAvatarShapes,
  drawBotAvatarFrame,
  shade,
  warmBotAvatarPlastic
} from 'bot-avatars'
import type { BotAvatarFace, BotAvatarState, BotAvatarType } from 'bot-avatars'
import { anchorsOf, anchorVariables, paintedBounds, type BodyBox } from '../botAnchors.js'

import { LOCUST_BOTS, isLocustBot } from '../locustBots.js'
import type { LocustBotType } from '../locustBots.js'

/**
 * A BOT: one of bot-avatars' eighteen, or one of Locust's own.
 *
 * Colin, 2026-09-22, on libraries.dev/bots: *"this is actually fucking
 * perfect brother, this could revamp our design so much"*. A bot is the
 * library's engine -- its rig, its renderer, its plastic -- given an outline
 * (the library's own, or ours from locustBots.ts), drawn here the way the
 * library draws its own: a canvas half again the box, pulled back by negative
 * margins so a hop or a turn is never clipped, and lifted by the library's
 * rise so every body sits in its box alike.
 *
 * EVERY SHAPE IS DRAWN BY THE RIG HERE (0.300). The library's eighteen used
 * to be its own `BotAvatar`, which keeps its rig to itself: it takes a state
 * and follows the real pointer, and nothing else can move it. So a teammate
 * that finished could not hop, and two teammates could not look at each
 * other -- Colin's "have fun" list, 2026-09-23: *"you can run all those"*.
 * Locust's own two were already drawn here, from the library's exported
 * pieces; now all twenty are, with the library's outline, face placement and
 * colour treatment for its eighteen, so each draws as it did (checked pixel
 * for pixel against BotAvatar, probe-bots-drawn-alike).
 *
 * Decorative: the name belongs beside it, as with the faces.
 */

export type BotType = BotAvatarType | LocustBotType

/** A teammate hue drawn on plastic: its token, a touch more vivid than flat. */
const SATURATION = 1.15

/** BotAvatar's own saturation, for a library shape wearing its own colour. */
const PALETTE_SATURATION = 1.5

/** Which way a bot glances, in head widths from its head: -1 to 1 across, -1 up to 1 down. */
export interface Glance {
  readonly x: number
  readonly y: number
}

/** How long a glance holds before the eyes come back. */
export const GLANCE_HOLD_MS = 1_500

/** A hop takes about this long from the crouch to its own shape again (the library's click jump). */
export const HOP_MS = 1_500

export interface BotProps {
  readonly type: BotType
  readonly size: number
  /** A resolved colour. Undefined: the shape's own. */
  readonly color?: string
  readonly state?: BotAvatarState
  /** Still, in the state's resting pose. */
  readonly paused?: boolean
  readonly face?: BotAvatarFace
  readonly seed?: number
  /** Eyes follow a nearby pointer, and a click makes it hop. */
  readonly interactive?: boolean
  /** Seconds between idle jumps, give or take; 0 for none (the library's `jumpEvery`). */
  readonly jumpEvery?: number
  /** Hops once, straight up, each time this turns true: a moment, not a state. */
  readonly hop?: boolean
  /** Looks this way for a moment (GLANCE_HOLD_MS) each time it is given, then back. */
  readonly glance?: Glance
}

/**
 * SMALL BOTS ARE DRAWN AT TWICE THEIR SIZE AND SHRUNK.
 *
 * Colin, 2026-09-23: *"the smaller renditions of the teammates have very
 * jagged edges from downscaling"*. Enlarged from a packaged frame, a 16px
 * sidebar bot's outline and antennae were hard stair-steps beside
 * anti-aliased text: the plastic is shaded pixel by pixel at the canvas's
 * own resolution, so at 14-26px an edge pixel is body or background and
 * never between. Drawn at 2x and scaled to half by the compositor, each
 * pixel on screen is the average of four, and the edge is smooth again. An
 * exact half, because a 2:1 bilinear shrink averages four texels evenly
 * where another ratio would skip some. A canvas four times the pixels at
 * this size is still a few thousand of them; above it the canvas already
 * has pixels to spare.
 */
export const SUPERSAMPLE_AT_OR_BELOW = 32

export function Bot(props: BotProps): ReactElement {
  if (props.size > SUPERSAMPLE_AT_OR_BELOW) return <RiggedBot {...props} />
  return (
    <span className="lc-bot__supersample" style={{ width: props.size, height: props.size }}>
      <span className="lc-bot__supersample-inner" style={{ width: props.size * 2, height: props.size * 2 }}>
        <RiggedBot {...props} size={props.size * 2} />
      </span>
    </span>
  )
}

/** What the rig needs to draw a shape. */
interface Outline {
  /** What the library's plastic is cached under: its own name for its own shapes. */
  readonly key: string
  readonly body: string
  /** Thin parts (antennae, legs, wings) drawn behind the body. */
  readonly parts: string | undefined
  /** Of the body's depth; undefined is the library's own. */
  readonly partsDepth: number | undefined
  /** How far the head swings while idle, 1 as the library has it. */
  readonly turn: number
  readonly face: BotAvatarFace
  readonly faceX: number
  readonly faceY: number
  readonly faceScale: number
}

export function outlineOf(type: BotType): Outline {
  if (isLocustBot(type)) {
    const shape = LOCUST_BOTS[type]
    return {
      key: `locust-${type}`,
      body: shape.body,
      parts: shape.parts,
      partsDepth: shape.partsDepth,
      turn: shape.turn,
      face: 'eyes',
      faceX: shape.faceX,
      faceY: shape.faceY,
      faceScale: shape.faceScale
    }
  }
  const preset = botAvatarPresets[type]
  return {
    key: type,
    body: botAvatarShapes[type],
    parts: botAvatarParts[type],
    partsDepth: undefined,
    turn: 1,
    face: preset.face,
    faceX: preset.faceX,
    faceY: preset.faceY,
    faceScale: preset.faceScale
  }
}

/**
 * The body colour, painted as BotAvatar painted it: a library shape's colour
 * with its saturation raised (the library's `shade`, half of what the
 * saturation adds) -- ours on a teammate's hue, the library's own on its
 * palette. Locust's own two always took their colour flat, and still do.
 */
export function bodyColorOf(type: BotType, color: string | undefined): string {
  if (isLocustBot(type)) return color ?? botAvatarPalette.alien
  const saturation = color === undefined ? PALETTE_SATURATION : SATURATION
  return shade(color ?? botAvatarPresets[type].color, 0, (saturation - 1) * 0.5)
}

/** Where the pointer is on the page, shared by every bot that follows one, as the library shares its own. */
const pointer = { x: Number.NaN, y: Number.NaN }
let pointerWatched = false

function watchPointer(): void {
  if (pointerWatched || typeof document === 'undefined') return
  pointerWatched = true
  document.addEventListener(
    'pointermove',
    (event) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
    },
    { passive: true }
  )
  const gone = (): void => {
    pointer.x = Number.NaN
    pointer.y = Number.NaN
  }
  document.addEventListener('pointerleave', gone)
  window.addEventListener('blur', gone)
}

export interface Pull {
  readonly x: number
  readonly y: number
  /** 0 lets go, 1 looks straight at it. */
  readonly strength: number
}

/**
 * How a bot follows a pointer -- BotAvatar's own rule, so the cover's ghost
 * and droid follow it as they did: where it is from the head, in head widths
 * and never more than one, and how hard to look, fully within a head's
 * width and letting go by three.
 */
export function pointerPull(
  box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  x: number,
  y: number
): Pull {
  const head = box.width / BOT_AVATAR_OVERSCAN || 1
  const dx = (x - (box.left + box.width / 2)) / head
  const dy = (y - (box.top + box.height / 2 + BOT_AVATAR_RISE * head)) / head
  const distance = Math.hypot(dx, dy)
  const strength = distance < 1 ? 1 : distance > 3 ? 0 : 1 - (distance - 1) / 2
  return { x: dx / Math.max(1, distance), y: dy / Math.max(1, distance), strength }
}

/** What a bot's clock runs on: the window's own, unless a test hands it another. */
export interface BotFrames {
  readonly requestAnimationFrame: (callback: (now: number) => void) => number
  readonly cancelAnimationFrame: (handle: number) => void
  readonly now: () => number
}

/**
 * How often a moving bot is drawn, at most, a second.
 *
 * A beta tester, 2026-09-23: "Lowkey my computer feels noticeably slower
 * while running locust". Measured on 0.302: the home screen in front cost
 * 39.6% of one core, 28 of it the GPU process -- each bot's plastic lit per
 * pixel and handed to the GPU on EVERY animation frame, which is 60 a second
 * on most screens and 144 on a gaming laptop's. A look round, a bob and a hop
 * read the same at 30.
 */
export const BOT_FRAMES_PER_SECOND = 30

/**
 * A MOVING BOT'S CLOCK: its first frame now, then one per animation frame
 * while it is showing, at most BOT_FRAMES_PER_SECOND of them. Returns the way
 * to stop it.
 *
 * The first frame is drawn at once, as bot-avatars draws its own shapes. A
 * page that is not being painted runs no animation frames -- a tab in the
 * background, a window not shown yet -- and a Locust bot that waited for one
 * stayed blank there while the library's shapes beside it were drawn: the
 * design system's cover, opened in a background tab, had the ghost and the
 * droid on the machine and no Hopper (2026-09-23). Setting the canvas's size
 * clears it, too, so a bot whose state changed while nothing was painting
 * went blank the same way.
 */
export function startBotClock(
  draw: () => void,
  step: (seconds: number) => void,
  showing: () => boolean,
  frames: BotFrames = {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now()
  }
): () => void {
  draw()
  let last = frames.now()
  let handle = 0
  // A millisecond of slack, so a 60 Hz screen's second frame (33.3 ms) is not
  // turned away for arriving a hair early.
  const every = 1000 / BOT_FRAMES_PER_SECOND - 1
  const tick = (now: number): void => {
    // A frame too soon after the last is passed over, and its time goes to the next.
    if (now - last >= every) {
      const seconds = Math.min(0.05, (now - last) / 1000)
      last = now
      if (showing()) {
        step(seconds)
        draw()
      }
    }
    handle = frames.requestAnimationFrame(tick)
  }
  handle = frames.requestAnimationFrame(tick)
  return () => frames.cancelAnimationFrame(handle)
}

/**
 * Where each shape's paint falls on its OWN canvas, per the state it was
 * drawn in, as fractions of the canvas -- read from the pixels once, the
 * first time that shape is drawn, and the same for every bot of it after.
 */
const PAINT = new Map<string, BodyBox>()

/**
 * Puts the bot's waiting ring and presence dot ON the bot: the CSS variables
 * they read (botAnchors.ts), on the `.lc-bot` that holds this canvas -- a
 * TeammateBot, a cover face. Returns false when there is nothing laid out to
 * measure yet, so the caller can try again once the bot is on screen.
 *
 * WHERE THE CANVAS IS, MEASURED, NOT ASSUMED. The first version worked out
 * the canvas's place from its margins, and on the cover it was 27 px out: the
 * cover's face is a plain block, the canvas's negative top margin collapses
 * through it, and the BOX rises while the drawing stays -- which is the whole
 * of what Colin saw (the dots and the droid's ring riding high). A sidebar
 * face is a flex box, where nothing collapses. So only the paint's place on
 * the canvas is kept; the canvas's place in its box is read each time.
 */
function anchorToBody(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, key: string): boolean {
  const host = canvas.closest<HTMLElement>('.lc-bot')
  if (host === null) return true
  let paint = PAINT.get(key)
  if (paint === undefined) {
    let painted: ReturnType<typeof paintedBounds>
    try {
      painted = paintedBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
    } catch {
      return true
    }
    if (painted === undefined) return false
    paint = {
      left: painted.left / canvas.width,
      top: painted.top / canvas.height,
      right: painted.right / canvas.width,
      bottom: painted.bottom / canvas.height
    }
    PAINT.set(key, paint)
  }
  const drawn = canvas.getBoundingClientRect()
  const box = host.getBoundingClientRect()
  const width = host.offsetWidth
  const height = host.offsetHeight
  if (drawn.width === 0 || box.width === 0 || box.height === 0 || width === 0 || height === 0) return false
  // Page pixels to the box's own (an ancestor may be scaled), then to fractions of it.
  const across = (x: number): number => ((x - box.left) * (width / box.width)) / width
  const down = (y: number): number => ((y - box.top) * (height / box.height)) / height
  const body: BodyBox = {
    left: across(drawn.left + paint.left * drawn.width),
    top: down(drawn.top + paint.top * drawn.height),
    right: across(drawn.left + paint.right * drawn.width),
    bottom: down(drawn.top + paint.bottom * drawn.height)
  }
  for (const [name, value] of Object.entries(anchorVariables(anchorsOf(body)))) host.style.setProperty(name, value)
  return true
}

function RiggedBot({
  type,
  size,
  color,
  state = 'default',
  paused = false,
  face,
  seed = 0.37,
  interactive = false,
  jumpEvery,
  hop = false,
  glance
}: BotProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const rig = useRef<BotAvatarSim | null>(null)
  // What each frame reads, so a glance or the pointer never restarts the rig.
  const aim = useRef<{ follows: boolean; glance: Glance | undefined; glancedAt: number }>({
    follows: interactive,
    glance: undefined,
    glancedAt: 0
  })

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return undefined
    const outline = outlineOf(type)
    const body = bodyColorOf(type, color)
    const ink = autoInk(body)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const side = Math.round(size * BOT_AVATAR_OVERSCAN * dpr)
    canvas.width = side
    canvas.height = side
    const path = new Path2D(outline.body)
    const parts = outline.parts === undefined ? undefined : new Path2D(outline.parts)
    warmBotAvatarPlastic(outline.key, path, size * dpr)
    const sim = new BotAvatarSim(seed, state)
    sim.setTurn(outline.turn)
    // BotAvatar takes `jumpEvery` as a prop; the rig is set the same way, so
    // a subtle bot never flips.
    if (jumpEvery !== undefined) sim.setJump({ every: jumpEvery })
    rig.current = sim
    const still = paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const draw = (): void => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, side, side)
      drawBotAvatarFrame(context, size, sim.pose, {
        path,
        ...(parts === undefined ? {} : { parts }),
        ...(outline.partsDepth === undefined ? {} : { partsDepth: outline.partsDepth }),
        typeKey: outline.key,
        face: face ?? outline.face,
        faceX: outline.faceX,
        faceY: outline.faceY,
        faceScale: outline.faceScale,
        color: body,
        ink,
        shading: 'plastic',
        dpr,
        theme: 'dark',
        still
      })
    }
    let anchored = false
    const anchor = (): void => {
      if (!anchored) anchored = anchorToBody(canvas, context, `${outline.key}|${state}`)
    }
    if (still) {
      draw()
      anchor()
      return undefined
    }
    watchPointer()
    let onScreen = true
    const stop = startBotClock(
      draw,
      (seconds) => {
        const { follows, glance: toward, glancedAt } = aim.current
        if (toward !== undefined && performance.now() - glancedAt < GLANCE_HOLD_MS) {
          sim.setPointer(toward.x, toward.y, 1)
        } else if (follows && !Number.isNaN(pointer.x)) {
          const pull = pointerPull(canvas.getBoundingClientRect(), pointer.x, pointer.y)
          sim.setPointer(pull.x, pull.y, pull.strength)
        } else {
          sim.setPointer(0, 0, 0)
        }
        sim.update(seconds)
      },
      () => onScreen && document.visibilityState !== 'hidden'
    )
    // The clock drew the first frame already: the bot at rest, where its ring and dot belong.
    anchor()
    const watch =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? true
            // A bot mounted out of sight is measured once it is in sight.
            if (onScreen) anchor()
          })
    watch?.observe(canvas)
    return () => {
      stop()
      watch?.disconnect()
      rig.current = null
    }
    // A new state eases in on the running rig (below); only a still bot is
    // redrawn from scratch for one.
  }, [type, size, color, face, seed, paused, paused ? state : undefined, jumpEvery])

  useEffect(() => {
    if (!paused) rig.current?.setState(state)
  }, [state, paused])

  useEffect(() => {
    aim.current.follows = interactive
  }, [interactive])

  // A glance starts its hold when it is given, and again for a new one.
  useEffect(() => {
    aim.current.glance = glance
    aim.current.glancedAt = performance.now()
  }, [glance?.x, glance?.y])

  /*
   * A hop is the library's own jump -- the crouch, the stretch in the air,
   * the squash on landing -- with no turn in it: a click's jump spins right
   * round, which is a flip, and a teammate that just finished is not
   * showing off. The turn comes back once it has landed, and not before,
   * whenever the hop's moment ends. Declared after the rig's effect, so a
   * bot woken for its hop hops on the rig just made.
   */
  const landing = useRef(0)
  useEffect(() => () => window.clearTimeout(landing.current), [])
  useEffect(() => {
    if (!hop) return
    const sim = rig.current
    if (sim === null) return
    sim.setJump({ spin: 0 })
    sim.poke()
    window.clearTimeout(landing.current)
    landing.current = window.setTimeout(() => sim.setJump({ spin: botAvatarJumpDefaults.spin }), HOP_MS)
  }, [hop])

  const box = size * BOT_AVATAR_OVERSCAN
  const pull = ((BOT_AVATAR_OVERSCAN - 1) / 2) * size
  return (
    <canvas
      ref={ref}
      aria-hidden
      onClick={interactive ? () => rig.current?.poke() : undefined}
      style={{
        display: 'block',
        flex: 'none',
        width: box,
        height: box,
        marginLeft: -pull,
        marginRight: -pull,
        marginTop: -(pull + BOT_AVATAR_RISE * size),
        marginBottom: -(pull - BOT_AVATAR_RISE * size)
      }}
    />
  )
}
