import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import {
  BOT_AVATAR_OVERSCAN,
  BOT_AVATAR_RISE,
  BotAvatar,
  BotAvatarSim,
  autoInk,
  botAvatarPalette,
  drawBotAvatarFrame,
  warmBotAvatarPlastic
} from 'bot-avatars'
import type { BotAvatarFace, BotAvatarState, BotAvatarType } from 'bot-avatars'

import { LOCUST_BOTS, isLocustBot } from '../locustBots.js'
import type { LocustBotType } from '../locustBots.js'

/**
 * A BOT: one of bot-avatars' eighteen, or one of Locust's own.
 *
 * Colin, 2026-09-22, on libraries.dev/bots: *"this is actually fucking
 * perfect brother, this could revamp our design so much"*. The library's
 * `BotAvatar` draws its own shapes; a Locust bot is the same engine -- its
 * rig, its renderer, its plastic -- given our outline (see locustBots.ts),
 * drawn here the way the library draws its own: a canvas half again the box,
 * pulled back by negative margins so a hop or a turn is never clipped, and
 * lifted by the library's rise so every body sits in its box alike.
 *
 * Decorative: the name belongs beside it, as with the faces.
 */

export type BotType = BotAvatarType | LocustBotType

/** A teammate hue drawn on plastic: its token, a touch more vivid than flat. */
const SATURATION = 1.15

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
  if (props.size > SUPERSAMPLE_AT_OR_BELOW) return <DrawnBot {...props} />
  return (
    <span className="lc-bot__supersample" style={{ width: props.size, height: props.size }}>
      <span className="lc-bot__supersample-inner" style={{ width: props.size * 2, height: props.size * 2 }}>
        <DrawnBot {...props} size={props.size * 2} />
      </span>
    </span>
  )
}

function DrawnBot({ type, size, color, state = 'default', paused = false, face, seed, interactive = false, jumpEvery }: BotProps): ReactElement {
  if (isLocustBot(type)) {
    return (
      <LocustBot
        type={type}
        size={size}
        state={state}
        paused={paused}
        interactive={interactive}
        {...(color === undefined ? {} : { color })}
        {...(face === undefined ? {} : { face })}
        {...(seed === undefined ? {} : { seed })}
        {...(jumpEvery === undefined ? {} : { jumpEvery })}
      />
    )
  }
  return (
    <BotAvatar
      type={type}
      size={size}
      state={state}
      paused={paused}
      theme="dark"
      interactive={interactive}
      aria-hidden
      {...(color === undefined ? {} : { color, saturation: SATURATION })}
      {...(face === undefined ? {} : { face })}
      {...(seed === undefined ? {} : { seed })}
      {...(jumpEvery === undefined ? {} : { jumpEvery })}
    />
  )
}

function LocustBot({
  type,
  size,
  color,
  state,
  paused,
  face = 'eyes',
  seed = 0.37,
  interactive,
  jumpEvery
}: {
  readonly type: LocustBotType
  readonly size: number
  readonly color?: string
  readonly state: BotAvatarState
  readonly paused: boolean
  readonly face?: BotAvatarFace
  readonly seed?: number
  readonly interactive: boolean
  readonly jumpEvery?: number
}): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const rig = useRef<BotAvatarSim | null>(null)

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return undefined
    const shape = LOCUST_BOTS[type]
    // The library's own lime stands in when no hue reached us, so no colour
    // is typed here.
    const body = color ?? botAvatarPalette.alien
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const side = Math.round(size * BOT_AVATAR_OVERSCAN * dpr)
    canvas.width = side
    canvas.height = side
    const path = new Path2D(shape.body)
    const parts = new Path2D(shape.parts)
    const key = `locust-${type}`
    warmBotAvatarPlastic(key, path, size * dpr)
    const sim = new BotAvatarSim(seed, state)
    sim.setTurn(shape.turn)
    // The library's BotAvatar takes `jumpEvery` as a prop; our rig is set
    // the same way, so a subtle Locust bot never flips either.
    if (jumpEvery !== undefined) sim.setJump({ every: jumpEvery })
    rig.current = sim
    const still = paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const draw = (): void => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, side, side)
      drawBotAvatarFrame(context, size, sim.pose, {
        path,
        parts,
        partsDepth: shape.partsDepth,
        typeKey: key,
        face,
        faceX: shape.faceX,
        faceY: shape.faceY,
        faceScale: shape.faceScale,
        color: body,
        ink: autoInk(body),
        shading: 'plastic',
        dpr,
        theme: 'dark',
        still
      })
    }
    if (still) {
      draw()
      return undefined
    }
    let handle = 0
    let last = performance.now()
    let onScreen = true
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (onScreen && document.visibilityState !== 'hidden') {
        sim.update(dt)
        draw()
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    const watch =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? true
          })
    watch?.observe(canvas)
    return () => {
      cancelAnimationFrame(handle)
      watch?.disconnect()
      rig.current = null
    }
    // A new state eases in on the running rig (below); only a still bot is
    // redrawn from scratch for one.
  }, [type, size, color, face, seed, paused, paused ? state : undefined, jumpEvery])

  useEffect(() => {
    if (!paused) rig.current?.setState(state)
  }, [state, paused])

  const box = size * BOT_AVATAR_OVERSCAN
  const pull = ((BOT_AVATAR_OVERSCAN - 1) / 2) * size
  return (
    <canvas
      ref={ref}
      aria-hidden
      onClick={interactive ? () => rig.current?.poke() : undefined}
      style={{
        display: 'block',
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
