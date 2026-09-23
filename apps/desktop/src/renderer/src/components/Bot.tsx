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

export function Bot({ type, size, color, state = 'default', paused = false, face, seed, interactive = false, jumpEvery }: BotProps): ReactElement {
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
  interactive
}: {
  readonly type: LocustBotType
  readonly size: number
  readonly color?: string
  readonly state: BotAvatarState
  readonly paused: boolean
  readonly face?: BotAvatarFace
  readonly seed?: number
  readonly interactive: boolean
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
  }, [type, size, color, face, seed, paused, paused ? state : undefined])

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
