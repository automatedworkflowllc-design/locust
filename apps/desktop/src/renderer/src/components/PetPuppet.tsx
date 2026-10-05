import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { BOT_AVATAR_OVERSCAN, BOT_AVATAR_RISE, BotAvatarSim, botAvatarJumpDefaults } from 'bot-avatars'
import type { BotAvatarPose, BotAvatarState } from 'bot-avatars'

import type { PetRef } from '../../../shared/avatar.js'
import type { PetState } from '../../../shared/pets.js'
import { anchorsOf, anchorVariables } from '../botAnchors.js'
import type { BodyBox } from '../botAnchors.js'
import type { PetPuppet as Puppet } from '../petPuppets.js'
import type { ScreenRect } from '../petScreens.js'
import type { PetAtlas } from '../pets.js'
import { WINDOW_PRESENCE } from '../windowPresence.js'
import type { WindowPresence } from '../windowPresence.js'
import {
  GLAD_HOP,
  GLANCE_HOLD_MS,
  HOP_MS,
  LAG_REST,
  POWER_ON_S,
  SCREEN_RESTING_EYES,
  SETTLED_FRAMES,
  blinkNow,
  bodyConductor,
  faceChanges,
  firstBoot,
  glyphMotion,
  headingOf,
  pointerNow,
  pointerPull,
  powerOnEyes,
  screenLight,
  startBotClock,
  stepLag,
  watchPointer
} from './Bot.js'
import type { BotMood, EyeGlyphs, Glance, GlyphMotion, Lag, Phosphor } from './Bot.js'
import { GLASS_INK, glassUnits, paintGlass, paintPowerOn, paintScreenEyes } from './PetSprite.js'

/**
 * A PET AS A PUPPET, MOVED BY A BOT'S RIG (2026-10-05, petPuppets.ts).
 *
 * One drawing -- the pet's resting pose, its head cut from a body that walks
 * or a stand at its neck, or all of it (petPuppets.ts) -- drawn where a bot's
 * body is drawn and moved as a bot's is: the same rig (BotAvatarSim)
 * breathing, looking about and hopping, the same conductor (bodyConductor)
 * answering each change with a mood, a hop or a thinking look, the same change
 * of face (faceChanges: one blink, the new eyes under the lids), the same
 * clock that rests (startBotClock, SETTLED_FRAMES). It takes a bot's props, so
 * a teammate wearing it lives as a bot does: moods, glances, the pointer,
 * moments of its own.
 *
 * The drawing is laid in the bot's own body box -- a hundred units, the
 * canvas half as large again for its hops (BOT_AVATAR_OVERSCAN) -- and moved
 * by the rig's own body transform: placed by the pose's x and y, leaned by its
 * roll, squashed and stretched about its foot (PUPPET_SQUASH). A drawing
 * cannot turn as a bot's body does, so a turn and a nod move it a little that
 * way. Over its own face, a screen: the glass (paintGlass) and a bot screen's
 * eyes (paintScreenEyes), in their light, blinking with the rig's blinks. They
 * keep their place on the glass, as a bot screen's do: only a hop's weight
 * moves them (stepLag).
 */

/** How far a full turn or nod moves the drawing, in body units: a hint of the way it looks, not a step. */
const TURN_SHIFT = 3
const NOD_SHIFT = 2
/**
 * How much of a screen's squash and stretch (Bot's SCREEN_SQUASH) a puppet
 * keeps: half. Its hop's crouch flattened a drawing by a fifth, and a drawing
 * squashed that far is a picture stretched, not a body landing: half still lands.
 */
export const PUPPET_SQUASH = 0.5

/** The squash and stretch a puppet is drawn with: PUPPET_SQUASH of its pose's. */
export function puppetScale(pose: BotAvatarPose): { readonly sx: number; readonly sy: number } {
  return { sx: 1 + (pose.sx - 1) * PUPPET_SQUASH, sy: 1 + (pose.sy - 1) * PUPPET_SQUASH }
}

export interface PetPuppetProps {
  readonly pet: PetRef
  readonly atlas: PetAtlas
  readonly puppet: Puppet
  readonly size: number
  /** What its pet would play (petMotion.ts), said on the canvas for a drive to read. */
  readonly petState: PetState
  readonly state?: BotAvatarState
  readonly paused?: boolean
  readonly motionPresence?: WindowPresence
  readonly seed?: number
  readonly follows?: boolean
  readonly jumpEvery?: number
  readonly hop?: boolean
  readonly glance?: Glance
  readonly eyes?: EyeGlyphs
  readonly phosphor?: Phosphor
  readonly flash?: Phosphor
  readonly mood?: BotMood
  readonly blinkKey?: string
  readonly bootKey?: string
}

const within = (value: number): number => Math.max(0, Math.min(1, value))

/**
 * Where a puppet's drawing goes in a bot's body box: the canvas transform the
 * rig gives a body (drawBotAvatarFrame) for this pose, in a canvas `side`
 * device pixels across for a box `size` across at `dpr`, with the hint of a
 * turn and a nod. Drawn under it, the window of the drawing is the box's
 * hundred units, -50 to 50 across and down.
 */
export function puppetTransform(pose: BotAvatarPose, size: number, dpr: number): readonly [number, number, number, number, number, number] {
  const side = size * BOT_AVATAR_OVERSCAN * dpr
  const e = (size * dpr) / 100
  const roll = pose.roll
  const cos = Math.cos(roll)
  const sin = Math.sin(roll)
  const { sx, sy } = puppetScale(pose)
  const across = sx * e
  const down = sy * e
  // Squashed, its foot stays where it is: the lost height comes off its top (the rig's own rule).
  const foot = 50 * (1 - sy) * e
  const x = side / 2 + (pose.x + Math.sin(pose.yaw) * TURN_SHIFT) * e - sin * foot
  const y = side / 2 + BOT_AVATAR_RISE * size * dpr + (pose.y - Math.sin(pose.pitch) * NOD_SHIFT) * e + cos * foot
  return [cos * across, sin * across, -sin * down, cos * down, x, y]
}

/** A rectangle of the drawing, in the box's units under puppetTransform. */
export function puppetRect(puppet: Puppet, x: number, y: number, w: number, h: number): ScreenRect {
  const [left, top, side] = puppet.window
  const k = 100 / side
  return { x: (x - left) * k - 50, y: (y - top) * k - 50, w: w * k, h: h * k }
}

/**
 * What of its sheet a puppet draws, in the sheet's pixels (`from`), and where
 * in the box's units (`to`): its resting drawing, as much of it as its window
 * shows (a window can reach past a drawing's edges), and nothing below its
 * neck, where it has one.
 */
export function puppetDrawing(puppet: Puppet, frameWidth: number, frameHeight: number): { readonly from: ScreenRect; readonly to: ScreenRect } {
  const [left, top, side] = puppet.window
  const [row, column] = puppet.rest
  const fromX = Math.max(0, left)
  const toX = Math.min(frameWidth, left + side)
  const fromY = Math.max(0, top)
  const toY = Math.min(frameHeight, top + side, puppet.neck ?? frameHeight)
  return {
    from: { x: column * frameWidth + fromX, y: row * frameHeight + fromY, w: toX - fromX, h: toY - fromY },
    to: puppetRect(puppet, fromX, fromY, toX - fromX, toY - fromY)
  }
}

/** Where its ring and dot sit (botAnchors.ts): on what is drawn of it, its paint, as fractions of its box. */
export function puppetBody(puppet: Puppet): BodyBox {
  const [left, top, side] = puppet.window
  const [paintLeft, paintTop, paintRight, paintBottom] = puppet.paint
  return {
    left: within((paintLeft - left) / side),
    top: within((paintTop - top) / side),
    right: within((paintRight - left) / side),
    bottom: within((paintBottom - top) / side)
  }
}

export function PetPuppet({
  pet,
  atlas,
  puppet,
  size,
  petState,
  state = 'default',
  paused = false,
  motionPresence = WINDOW_PRESENCE,
  seed = 0.37,
  follows = false,
  jumpEvery,
  hop = false,
  glance,
  eyes,
  phosphor,
  flash,
  mood,
  blinkKey,
  bootKey
}: PetPuppetProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const rig = useRef<BotAvatarSim | null>(null)
  // Read at each frame, so what it shows changes on the running rig, never a rebuilt one (as a bot's).
  const glyphs = useRef<EyeGlyphs>(eyes ?? SCREEN_RESTING_EYES)
  glyphs.current = eyes ?? SCREEN_RESTING_EYES
  const feeling = useRef(mood)
  feeling.current = mood
  const doing = useRef(blinkKey)
  doing.current = blinkKey
  const glowing = useRef(phosphor)
  glowing.current = phosphor
  const flashed = useRef(flash)
  flashed.current = flash
  const resting = useRef(paused)
  resting.current = paused
  const bootWanted = useRef(false)
  const bootAt = useRef<number | undefined>(undefined)
  const rigTime = useRef(0)
  const spinBackAt = useRef<number | undefined>(undefined)
  const hopWanted = useRef(false)
  const wake = useRef<(() => void) | undefined>(undefined)
  const aim = useRef<{ follows: boolean; glance: Glance | undefined; glancedAt: number }>({ follows, glance: undefined, glancedAt: 0 })

  // Declared before the rig's effect, so the very first frame of a screen that switches on is already dark.
  useEffect(() => {
    if (firstBoot(bootKey)) bootWanted.current = true
  }, [bootKey])

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const side = Math.round(size * BOT_AVATAR_OVERSCAN * dpr)
    canvas.width = side
    canvas.height = side
    const { from, to } = puppetDrawing(puppet, atlas.frameWidth, atlas.frameHeight)
    const glass = puppetRect(puppet, ...puppet.glass)
    const look = { glass: puppet.tint, ...(puppet.ink === undefined ? {} : { ink: puppet.ink }), ...(puppet.dark === undefined ? {} : { dark: puppet.dark }) }
    // Its ink round the glass, as wide as a pet's own lines (GLASS_INK), in the box's units.
    const ink = (GLASS_INK * 100) / puppet.window[2]
    const host = canvas.closest<HTMLElement>('.lc-bot')
    if (host !== null) {
      for (const [name, value] of Object.entries(anchorVariables(anchorsOf(puppetBody(puppet))))) host.style.setProperty(name, value)
    }
    canvas.toggleAttribute('data-pet-dark', atlas.dark)

    const sim = new BotAvatarSim(seed, state)
    if (jumpEvery !== undefined) sim.setJump({ every: jumpEvery })
    rig.current = sim
    const frozen = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    let restNow = resting.current ? 1 : 0
    const changes = faceChanges(
      () => ({ pair: glyphs.current, tone: glowing.current ?? 'cyan', key: doing.current }),
      () => flashed.current,
      () => bootAt.current
    )
    const answer = bodyConductor(seed, true, frozen, resting.current)
    let stop: (() => void) | undefined
    let settledFor = 0
    let gone = false
    let atOnce = false
    // The eyes' lag behind the body (Bot's stepLag), and the body's last height and speed it is measured from.
    let lag: Lag = LAG_REST
    let body: { readonly at: number; readonly y: number; readonly vy: number } | undefined

    const paint = (pose: BotAvatarPose, s: number, change: ReturnType<typeof changes.at>): void => {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, side, side)
      const matrix = puppetTransform(pose, size, dpr)
      context.setTransform(...matrix)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(atlas.image, from.x, from.y, from.w, from.h, to.x, to.y, to.w, to.h)
      // Device pixels a unit of the box is, for the glow (a canvas's blur is in device pixels, not the transform's).
      const scaled = puppetScale(pose)
      const device = ((size * dpr) / 100) * Math.sqrt(Math.max(0.01, scaled.sx * scaled.sy))
      const unit = 1 / glassUnits(glass)
      paintGlass(context, glass, look, ink, unit, puppet.corner)
      const light = screenLight(changes.shown().tone, changes.flash(), s)
      const phase = bootAt.current === undefined || s === 0 ? undefined : (s - bootAt.current) / POWER_ON_S
      const booting = phase === undefined || phase >= 1 ? undefined : Math.max(0, phase)
      if (booting !== undefined) paintPowerOn(context, glass, booting, light, unit, puppet.corner, device)
      const opened = booting === undefined ? 1 : powerOnEyes(booting)
      if (opened <= 0) return
      const pair = changes.shown().pair ?? SCREEN_RESTING_EYES
      const loopAt = (eye: 0 | 1): GlyphMotion => {
        const moved = glyphMotion(pair.join(''), eye, s - change.since)
        if (restNow <= 0) return moved
        const rest = glyphMotion(pair.join(''), eye, 0)
        const mix = (from: number, to: number): number => from + (to - from) * restNow
        return { dx: mix(moved.dx, rest.dx), dy: mix(moved.dy, rest.dy), sx: mix(moved.sx, rest.sx), sy: mix(moved.sy, rest.sy), shown: restNow >= 0.5 ? rest.shown : moved.shown }
      }
      // The rig's blinks close them; its doze does not (eyeOpen): a screen shows sleep with its own closed glyph.
      const blink = Math.max(pose.blinkL, pose.blinkR)
      const squash = 1 - 0.92 * Math.max(change.shut, blink, 1 - opened)
      // Where they sit on the glass: put, and moved only by a hop's weight, as a bot screen's eyes are.
      const dt = body === undefined ? 0 : s - body.at
      if (s === 0 || body === undefined || dt <= 0 || dt > 0.1) {
        lag = LAG_REST
        body = { at: s, y: pose.y, vy: 0 }
      } else {
        const vy = (pose.y - body.y) / dt
        lag = stepLag(lag, dt, 0, vy - body.vy)
        body = { at: s, y: pose.y, vy }
      }
      paintScreenEyes(context, glass, pair, [loopAt(0), loopAt(1)], squash, 1 - 0.92 * change.shut, light, 0, {
        ...(puppet.eyeScale === undefined ? {} : { scale: puppet.eyeScale }),
        ...(puppet.eyeY === undefined ? {} : { y: puppet.eyeY }),
        lookY: lag.y / 0.5,
        corners: puppet.corner,
        device
      })
      canvas.dataset.eyes = pair.join('')
    }

    const draw = (): void => {
      // A still face is drawn at second 0 (its change done at once, its loops at rest), a moving one on its own clock.
      const s = frozen || atOnce ? 0 : performance.now() / 1000 + seed * 17
      atOnce = false
      if (bootWanted.current && !frozen) {
        bootWanted.current = false
        bootAt.current = s + seed * 0.35
      }
      const change = changes.at(s)
      const { pose, changed, hop: hopNow, rest, settled } = answer.frame(s, change, sim.pose, headingOf(sim), {
        mood: feeling.current,
        hop: hopWanted.current,
        glancing: aim.current.glance !== undefined && performance.now() - aim.current.glancedAt < GLANCE_HOLD_MS,
        resting: resting.current
      })
      restNow = rest
      // A screen's blink is its swap; the rig's own next blink waits as after any blink.
      if (changed) blinkNow(sim, false)
      if (hopNow) {
        hopWanted.current = false
        sim.setJump(GLAD_HOP)
        sim.poke()
        spinBackAt.current = rigTime.current + HOP_MS / 1000
      }
      paint(pose, s, change)
      // Asked to keep still, it rests once it has settled (Bot's SETTLED_FRAMES): its clock stops, the frame left drawn.
      settledFor = settled && spinBackAt.current === undefined && !hopWanted.current ? settledFor + 1 : 0
      if (resting.current && settledFor >= SETTLED_FRAMES && stop !== undefined) {
        stop()
        stop = undefined
      }
    }
    if (frozen) {
      draw()
      wake.current = draw
      return () => {
        wake.current = undefined
        rig.current = null
      }
    }
    watchPointer()
    let onScreen = true
    const step = (seconds: number): void => {
      const { follows: following, glance: toward, glancedAt } = aim.current
      if (toward !== undefined && performance.now() - glancedAt < GLANCE_HOLD_MS) {
        sim.setPointer(toward.x, toward.y, 1)
      } else {
        const pointer = pointerNow()
        if (following && !Number.isNaN(pointer.x)) {
          const pull = pointerPull(canvas.getBoundingClientRect(), pointer.x, pointer.y)
          sim.setPointer(pull.x, pull.y, pull.strength)
        } else {
          sim.setPointer(0, 0, 0)
        }
      }
      sim.update(seconds)
      rigTime.current += Math.min(0.05, seconds)
      const restoreAt = spinBackAt.current
      if (restoreAt !== undefined && rigTime.current >= restoreAt) {
        spinBackAt.current = undefined
        sim.setJump({ spin: botAvatarJumpDefaults.spin, squashEase: botAvatarJumpDefaults.squashEase, riseEase: botAvatarJumpDefaults.riseEase })
      }
    }
    const run = (): void => {
      if (stop !== undefined || gone) return
      settledFor = 0
      // Woken where its clock may not run, that one frame is drawn still, its new face at once (Bot's).
      atOnce = motionPresence.away()
      stop = startBotClock(draw, step, () => onScreen && document.visibilityState !== 'hidden', undefined, motionPresence)
    }
    wake.current = run
    run()
    const watch =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? true
          })
    watch?.observe(canvas)
    return () => {
      gone = true
      stop?.()
      stop = undefined
      wake.current = undefined
      watch?.disconnect()
      rig.current = null
    }
    // What it is asked to show is performed on the running rig (below), never a rebuilt one.
  }, [atlas, puppet, size, seed, motionPresence])

  useEffect(() => {
    rig.current?.setState(state)
  }, [state])

  useEffect(() => {
    rig.current?.setJump({ every: jumpEvery ?? botAvatarJumpDefaults.every })
  }, [jumpEvery])

  // Anything new wakes it, as it wakes a bot.
  const asked = [eyes?.join('') ?? '', phosphor ?? '', flash ?? '', mood ?? '', blinkKey ?? '', state, paused ? 'still' : 'moving', hop ? 'hop' : ''].join('|')
  useEffect(() => {
    wake.current?.()
  }, [asked])

  useEffect(() => {
    aim.current.follows = follows
    if (follows) wake.current?.()
  }, [follows])

  useEffect(() => {
    aim.current.glance = glance
    aim.current.glancedAt = performance.now()
    wake.current?.()
  }, [glance?.x, glance?.y])

  useEffect(() => {
    hopWanted.current = hop
  }, [hop])

  const box = size * BOT_AVATAR_OVERSCAN
  const pull = ((BOT_AVATAR_OVERSCAN - 1) / 2) * size
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-face="pet"
      data-pet={pet.id}
      data-pet-state={petState}
      data-screen="on"
      data-puppet="on"
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
