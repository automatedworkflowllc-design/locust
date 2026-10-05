import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'

import type { PetRef } from '../../../shared/avatar.js'
import type { PetState } from '../../../shared/pets.js'
import { anchorsOf, anchorVariables } from '../botAnchors.js'
import { seeded } from '../faceLife.js'
import type { GlanceSide } from '../glances.js'
import { petCellAt, petFadeMs, petGlanceCell, petNextChangeIn } from '../petMotion.js'
import { RESTING, glanceBeat, moveCellAt } from '../petRoutines.js'
import type { Move } from '../petRoutines.js'
import { screenAt } from '../petScreens.js'
import { keepTweens, keptTweens, tweenKey } from '../petTweenStore.js'
import { TWEEN_MOMENTS, runInSlices, tweenSteps } from '../petTweens.js'
import type { PetScreenFace, ScreenRect } from '../petScreens.js'
import { usePetLook } from '../pets.js'
import type { PetAtlas } from '../pets.js'
import { WINDOW_PRESENCE } from '../windowPresence.js'
import type { WindowPresence } from '../windowPresence.js'
import {
  BLINK_GAP_S,
  CRT_FLICK_S,
  EYES_VISOR,
  GLANCE_HOLD_MS,
  GLYPH_SHAPES,
  POWER_ON_S,
  SCREEN_PAD,
  SCREEN_RESTING_EYES,
  SETTLED_FRAMES,
  faceChanges,
  firstBoot,
  glyphMotion,
  glyphReach,
  powerOnEyes,
  powerOnLight,
  sameHue,
  screenEyeLayout,
  screenLight,
  startBotClock,
  traceGlyph
} from './Bot.js'
import type { CrtRule, EyeGlyphs, GlyphMotion, Phosphor, VisorBox } from './Bot.js'

/**
 * A PET, DRAWN IN A TEAMMATE'S FACE'S BOX (0.563).
 *
 * One frame of the pet's sheet at a time, fitted to the box by its height
 * (frames are 192 x 208, and a pet's makers fill them) and centred, so a pet
 * stands where a bot stands. Nothing is added to the art: no plastic, no
 * outline, no tint -- a pet is drawn art and keeps its own look, and the
 * teammate's colour stays in its name and its marks. Bots and pets side by
 * side read as two kinds of teammate, which they are.
 *
 * ITS CLOCK WAKES ONLY WHEN THE FRAME CHANGES. A bot is drawn up to 30 times
 * a second because it moves continuously; a pet's rows step a few times a
 * second (OpenPets' timings: 6 frames in 820 ms at work), and its resting
 * pose not at all, so this sleeps until the next frame is due and draws only
 * when it changes. Like a bot, it holds still out of sight, in a window in
 * the background, and for reduced motion.
 *
 * Drawn on a canvas rather than moved as a CSS sprite so its frame is cut
 * exactly -- a stepped background or transform lands frames on fractions of
 * a pixel at these sizes and shows a sliver of the next one -- and so its
 * paint can be measured for the waiting ring and the presence dot, which sit
 * on its body as they sit on a bot's (botAnchors.ts).
 *
 * SMOOTHER, 0.564: each new drawing appears with the last fading off it
 * (petFadeMs), a few animation frames and then asleep again; and a pet whose
 * resting pose is near-black wears a faint light rim (`data-pet-dark`,
 * shell.css) so it does not sink into the dark ground.
 */
export interface PetSpriteProps {
  readonly pet: PetRef
  readonly size: number
  readonly state: PetState
  /** Holds its pose; a pet at rest always does. */
  readonly still?: boolean
  /** Looks this way for a moment (glances.ts): a version 2 head turns. */
  readonly glance?: GlanceSide
  /**
   * Its face as a screen, for a pet whose drawings have been measured for one
   * (petScreens.ts, Codex Buddy): what its screen shows and its body does.
   * Any other pet, or a sheet the table does not fit, keeps the face its
   * maker drew, and ignores it.
   */
  readonly screen?: PetScreenAsk
  /** 0-1 from its teammate: its blinks, its first lift and the moment its screen switches on, not a row's in unison. */
  readonly seed?: number
  /** Its screen switches on once a session for this key, as it first appears (Bot's bootKey). */
  readonly bootKey?: string
  /** When its clock rests (Bot's motionPresence): the window's, otherwise. */
  readonly motionPresence?: WindowPresence
}

/** Puts the ring and the dot on the pet's body: where its paint is, as fractions of the box. */
function anchorToBox(canvas: HTMLCanvasElement, body: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }): void {
  const host = canvas.closest<HTMLElement>('.lc-bot')
  if (host === null) return
  for (const [name, value] of Object.entries(anchorVariables(anchorsOf(body)))) host.style.setProperty(name, value)
}

/** Puts the ring and the dot on the pet's body: its resting pose's paint, placed in the box. */
export function anchorToPet(canvas: HTMLCanvasElement, atlas: PetAtlas, left: number, width: number): void {
  const body = atlas.body
  // The frame fills the box's height, so a fraction of the frame's height is one of the box's.
  anchorToBox(canvas, { left: left + body.left * width, top: body.top, right: left + body.right * width, bottom: body.bottom })
}

export function PetSprite({ pet, size, state, still = false, glance, screen, seed = 0, bootKey, motionPresence }: PetSpriteProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const look = usePetLook(pet)
  // When the state began, kept across a glance so a jump is not restarted by one.
  const began = useRef<{ state: PetState; at: number } | undefined>(undefined)
  const glanced = useRef<{ side: GlanceSide; at: number } | undefined>(undefined)

  useEffect(() => {
    glanced.current = glance === undefined ? undefined : { side: glance, at: performance.now() }
  }, [glance])

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null || look?.status !== 'ready') return undefined
    const context = canvas.getContext('2d')
    if (context === null) return undefined
    const atlas = look.atlas
    if (began.current?.state !== state) began.current = { state, at: performance.now() }
    const startedAt = began.current.at
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const side = Math.max(1, Math.round(size * dpr))
    canvas.width = side
    canvas.height = side
    const drawWidth = (side * atlas.frameWidth) / atlas.frameHeight
    const left = (side - drawWidth) / 2
    anchorToPet(canvas, atlas, left / side, drawWidth / side)
    const frozen = still || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    let drawn = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    let onScreen = true
    const fadeMs = petFadeMs(state, frozen)
    // The drawing fading out, and when the one replacing it appeared.
    let fading: { readonly row: number; readonly column: number; readonly at: number } | undefined
    let shownCell: { readonly row: number; readonly column: number } | undefined
    let frame: number | undefined
    canvas.toggleAttribute('data-pet-dark', atlas.dark)

    const paint = (cell: { readonly row: number; readonly column: number }, alpha: number): void => {
      context.globalAlpha = alpha
      context.drawImage(
        atlas.image,
        cell.column * atlas.frameWidth,
        cell.row * atlas.frameHeight,
        atlas.frameWidth,
        atlas.frameHeight,
        left,
        0,
        drawWidth,
        side
      )
      context.globalAlpha = 1
    }

    const render = (now: number): void => {
      if (shownCell === undefined) return
      context.clearRect(0, 0, side, side)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      paint(shownCell, 1)
      const remaining = fading === undefined ? 0 : 1 - (now - fading.at) / fadeMs
      if (fading !== undefined && remaining > 0) {
        paint(fading, remaining)
        // A few animation frames until it is gone; a covered window draws none, and the next tick ends it.
        frame ??= requestAnimationFrame((at) => {
          frame = undefined
          render(at)
        })
      } else {
        fading = undefined
      }
    }

    const glancing = (now: number): GlanceSide | undefined => {
      const looking = glanced.current
      return looking !== undefined && now - looking.at < GLANCE_HOLD_MS ? looking.side : undefined
    }

    const draw = (now: number): void => {
      const cell = petCellAt(state, now - startedAt, atlas.rows, frozen)
      const toward = glancing(now)
      const turned = toward === undefined ? undefined : petGlanceCell(toward, atlas.rows)
      const shown = turned ?? cell
      canvas.dataset.petState = cell.shown
      const key = `${String(shown.row)}:${String(shown.column)}`
      if (key === drawn) {
        // Past its fade: the new drawing alone.
        if (fading !== undefined && now - fading.at >= fadeMs) render(now)
        return
      }
      drawn = key
      fading = fadeMs > 0 && shownCell !== undefined && onScreen ? { ...shownCell, at: now } : undefined
      shownCell = { row: shown.row, column: shown.column }
      render(now)
    }

    const tick = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      const now = performance.now()
      draw(now)
      if (!onScreen || document.visibilityState === 'hidden') return
      const looking = glanced.current
      const glanceLeft = looking !== undefined && now - looking.at < GLANCE_HOLD_MS ? GLANCE_HOLD_MS - (now - looking.at) : undefined
      const next = petNextChangeIn(state, now - startedAt, frozen)
      const wait = next === undefined ? glanceLeft : glanceLeft === undefined ? next : Math.min(next, glanceLeft)
      if (wait !== undefined) timer = setTimeout(tick, Math.max(16, wait))
    }

    tick()
    const watch =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            const was = onScreen
            onScreen = entry?.isIntersecting ?? true
            if (onScreen && !was) tick()
          })
    watch?.observe(canvas)
    const wake = (): void => {
      if (document.visibilityState !== 'hidden') tick()
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      if (frame !== undefined) cancelAnimationFrame(frame)
      watch?.disconnect()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [look, size, state, still, glance])

  const faced = look?.status === 'ready' ? look.atlas.screen : undefined
  if (screen !== undefined && faced !== undefined && look?.status === 'ready') {
    return (
      <ScreenPet
        pet={pet}
        atlas={look.atlas}
        face={faced}
        size={size}
        state={state}
        ask={screen}
        still={still}
        seed={seed}
        {...(glance === undefined ? {} : { glance })}
        {...(bootKey === undefined ? {} : { bootKey })}
        {...(motionPresence === undefined ? {} : { motionPresence })}
      />
    )
  }
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-face="pet"
      data-pet={pet.id}
      data-pet-state={state}
      style={{ display: 'block', flex: 'none', width: size, height: size }}
    />
  )
}

/**
 * A PET WITH A SCREEN FOR A FACE (2026-10-05, petScreens.ts): Codex Buddy.
 *
 * His drawings, one at a time as a pet's are, each melting into the next --
 * and over his face on each one, a screen: his own ink round it, the glass
 * tinted his cap's blue, and on it the bots' eyes, which say what he is doing
 * as theirs do (TeammateBot's eyeGlyphsFor, phosphorFor, flashFor). The
 * screen is drawn as each drawing is; nothing of his is changed.
 *
 * His face changes as a bot's screen does (Bot's faceChanges): one blink, the
 * new eyes and their colour under the shut lids, then they open on the
 * state's own loops, the green flash with a finish's. Only then does his body
 * answer, with the move for what he is doing (petRoutines.ts): his workout,
 * his thinking, a wave, a chin-up, the bench press he is stuck under. He
 * blinks on his own between changes, and his screen switches on as he first
 * appears, as a bot's does.
 *
 * His eyes move, so while he does anything he is drawn as a bot is, up to 30
 * times a second on a bot's clock (startBotClock: held behind other windows
 * and out of sight). Asked to keep still -- at rest, stuck -- he finishes his
 * move, his eyes ease to rest, and his clock stops; something new wakes him.
 */

/** What a pet's screen is asked to show (TeammateBot): its eyes, their light, what it is doing, and its body's move. */
export interface PetScreenAsk {
  /** The eyes on the screen; undefined, the resting bars. */
  readonly eyes: EyeGlyphs | undefined
  readonly phosphor: Phosphor
  /** A colour its eyes flash as this arrives (FLASH_S): green as it finishes. */
  readonly flash?: Phosphor
  /** What it is doing (Bot's blinkKey): a new one is a change it performs, even with the same eyes. */
  readonly key: string
  /** What its body does for it, from the moment its eyes open on it. */
  readonly move: Move
  /** Kept still once its move is done (Bot's paused): its eyes ease to rest and its clock stops. */
  readonly rests: boolean
  /** Which of its changes come in as its screen switching on again (Bot's CrtRule); undefined, every one blinks. */
  readonly crt?: CrtRule
}

/**
 * HOW CLOSE HE IS FRAMED, BY HOW BIG HE IS DRAWN (2026-10-05). Colin: *"if
 * you need to make the model bigger to compensate for him having an entire
 * buddy thats fine, ill let you decide though"*. A bot is a head; he is a
 * whole body, and fitted whole into a bot's box his face was a seventh of its
 * height: at the 32 to 44 px he is nearly always drawn at (botSizes.ts:
 * the face you talk to 34, the sidebar 32, a card 44), a screen 6 px wide.
 * So the closer the smaller: from his cap to his waist at 44 px and under --
 * his face half as big again, his arms and weights in view -- easing out to
 * his knees at 64 (the New teammate preview) and to all of him from 96. A
 * square window on his drawing, from its top, across its middle.
 */
export const CLOSEST_FRAMING = 0.675
/** Drawn this size or smaller, he is framed closest. */
export const CLOSE_UNTIL_PX = 44
/** Drawn this size or larger, he is framed whole. */
export const WHOLE_FROM_PX = 96

/** The part of his drawing shown in a box `size` across: its left and top, and its side, in his drawing's pixels. */
export interface PetWindow {
  readonly left: number
  readonly top: number
  readonly side: number
}

export function petWindow(size: number, frameWidth: number, frameHeight: number): PetWindow {
  const t = Math.max(0, Math.min(1, (size - CLOSE_UNTIL_PX) / (WHOLE_FROM_PX - CLOSE_UNTIL_PX)))
  const side = frameHeight * (CLOSEST_FRAMING + (1 - CLOSEST_FRAMING) * t)
  return { left: (frameWidth - side) / 2, top: 0, side }
}

/** A screen's corners, as a fraction of its shorter side (a bot's visor's, 12 of 35). */
export const GLASS_CORNER = 0.32
/** His ink round the glass, in his drawing's pixels: as wide as his own lines. */
export const GLASS_INK = 2
/** One of his own blinks: shut and open again. bot-avatars' blink, 0.17 s. */
export const PET_BLINK_S = 0.17
/** How long his eyes take to ease to rest once he has finished his move and is asked to keep still. */
export const EYES_REST_S = 0.4

/** How a glass looks: its hue, an outline where there is ink, how dark beside a bot's visor (1). */
export interface GlassLook {
  readonly glass: string
  readonly ink?: string
  readonly dark?: number
}

/** A rounded rectangle's path. */
function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  context.beginPath()
  context.moveTo(x + k, y)
  context.arcTo(x + w, y, x + w, y + h, k)
  context.arcTo(x + w, y + h, x, y + h, k)
  context.arcTo(x, y + h, x, y, k)
  context.arcTo(x, y, x + w, y, k)
  context.closePath()
}

/**
 * The glass at `rect` (canvas pixels), as a bot's visor is drawn (Bot's
 * withGlyphEyes): his ink round it `ink` wide, the glass in his glass's hue,
 * lighter at the top, a soft sheen over its top half and a fine lit rim.
 * `unit` is the canvas pixels of a face unit, for the rim's weight.
 */
export function paintGlass(context: CanvasRenderingContext2D, rect: ScreenRect, face: GlassLook, ink: number, unit: number, corners = GLASS_CORNER): void {
  const corner = Math.min(rect.w, rect.h) * corners
  if (face.ink !== undefined) {
    context.fillStyle = face.ink
    roundedRect(context, rect.x - ink, rect.y - ink, rect.w + 2 * ink, rect.h + 2 * ink, corner + ink)
    context.fill()
  }
  const dark = face.dark ?? 1
  const ground = context.createLinearGradient(0, rect.y, 0, rect.y + rect.h)
  ground.addColorStop(0, sameHue(face.glass, 0.42, 0.17 * dark))
  ground.addColorStop(1, sameHue(face.glass, 0.5, 0.08 * dark))
  context.fillStyle = ground
  roundedRect(context, rect.x, rect.y, rect.w, rect.h, corner)
  context.fill()
  context.save()
  context.clip()
  const sheen = context.createLinearGradient(0, rect.y, 0, rect.y + rect.h / 2)
  sheen.addColorStop(0, 'rgba(255,255,255,0.13)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = sheen
  context.fillRect(rect.x, rect.y, rect.w, rect.h / 2)
  context.strokeStyle = 'rgba(255,255,255,0.16)'
  context.lineWidth = 1.6 * unit
  context.stroke()
  context.restore()
}

/** Switching on (POWER_ON_S, Bot's powerOnLight): the line of light across the glass, then its flash. */
export function paintPowerOn(
  context: CanvasRenderingContext2D,
  rect: ScreenRect,
  phase: number,
  light: { readonly lit: string; readonly glow: string },
  unit: number,
  corners = GLASS_CORNER,
  device = 1
): void {
  const on = powerOnLight(phase)
  const halfWidth = (rect.w / 2) * on.width
  const halfHeight = 0.9 * unit + (rect.h / 2 - 0.9 * unit) * on.height
  if (on.alpha <= 0.001 || halfWidth <= 0.001) return
  context.save()
  roundedRect(context, rect.x, rect.y, rect.w, rect.h, Math.min(rect.w, rect.h) * corners)
  context.clip()
  context.globalAlpha = on.alpha
  context.fillStyle = light.lit
  context.shadowColor = light.glow
  context.shadowBlur = 5 * unit * device
  context.fillRect(rect.x + rect.w / 2 - halfWidth, rect.y + rect.h / 2 - halfHeight, halfWidth * 2, halfHeight * 2)
  context.restore()
}

/** Face units a canvas pixel is, on a glass this wide: its glass is a bot's screen's width (EYES_VISOR), so its eyes are a bot's. */
export function glassUnits(rect: ScreenRect): number {
  return EYES_VISOR.halfWidth / (rect.w / 2)
}

/**
 * The eyes on the glass at `rect` (canvas pixels): placed and sized as a bot
 * screen's are (screenEyeLayout, with the glass as its visor), each moved by
 * its loop, squashed by a blink -- `squash`, or `closedSquash` for an eye
 * already shut in sleep -- lit and glowing in `light`. `look` slides them
 * toward the side he faces, as far as the glass has room.
 */
export function paintScreenEyes(
  context: CanvasRenderingContext2D,
  rect: ScreenRect,
  pair: EyeGlyphs,
  motions: readonly [GlyphMotion, GlyphMotion],
  squash: number,
  closedSquash: number,
  light: { readonly lit: string; readonly glow: string },
  look: number,
  how: { readonly scale?: number; readonly y?: number; readonly lookY?: number; readonly corners?: number; readonly device?: number } = {}
): void {
  const u = glassUnits(rect)
  const corners = how.corners ?? GLASS_CORNER
  const box: VisorBox = { halfWidth: EYES_VISOR.halfWidth, halfHeight: (rect.h / 2) * u, corner: Math.min(rect.w, rect.h) * corners * u, y: 0 }
  const laid = screenEyeLayout(box, pair, { x: look, y: how.lookY ?? 0 }, (how.y ?? 0) * box.halfHeight)
  // Larger on a glass with room for it (a pet whose whole face was its screen), never past what the glass holds.
  const larger = Math.max(1, how.scale ?? 1)
  const reaches = pair
    .map((glyph) => GLYPH_SHAPES[glyph] ?? GLYPH_SHAPES['•'])
    .filter((shape): shape is NonNullable<typeof shape> => shape !== undefined)
    .map(glyphReach)
  const reachX = Math.max(0, ...reaches.map((reach) => reach.x))
  const reachY = Math.max(0, ...reaches.map((reach) => reach.y))
  const roomX = box.halfWidth - SCREEN_PAD
  const roomY = box.halfHeight - SCREEN_PAD
  const scale = Math.min(laid.scale * larger, roomY / reachY, (roomX - 0.5) / (2 * reachX))
  const centres = laid.centres.map(([x, y]) => [Math.sign(x) * Math.min(Math.abs(x) * larger, roomX - reachX * scale), y] as const)
  const corner = Math.min(rect.w, rect.h) * corners
  const device = how.device ?? 1
  for (const eye of [0, 1] as const) {
    const shape = GLYPH_SHAPES[pair[eye]] ?? GLYPH_SHAPES['\u2022']
    const motion = motions[eye]
    if (shape === undefined || !motion.shown) continue
    const [x, y] = centres[eye] ?? [0, 0]
    context.save()
    roundedRect(context, rect.x, rect.y, rect.w, rect.h, corner)
    context.clip()
    context.translate(rect.x + rect.w / 2 + x / u, rect.y + rect.h / 2 + y / u)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = light.lit
    context.shadowColor = light.glow
    context.shadowBlur = (3.2 / u) * device
    const weight = traceGlyph(context, shape, motion, scale / u, shape.closed === true ? closedSquash : squash)
    context.lineWidth = (weight * scale) / u
    context.stroke()
    context.restore()
  }
}

/** How far apart his own blinks fall, before each one's jitter: with it, BLINK_GAP_S to 5 s apart, as the rig's are spaced. */
export const PET_BLINK_EVERY_S = 3.6
const PET_BLINK_JITTER_S = 1.4

/**
 * How shut one of his own blinks has his eyes at second `s` (0 open, 1 shut).
 * The `k`th falls BLINK_GAP_S + k x PET_BLINK_EVERY_S after the change his
 * eyes last opened on (`since`), a seeded moment later, so no two are less
 * than BLINK_GAP_S apart (Bot's blinkNow: none sooner after a change's) or
 * more than 5 s; each PET_BLINK_S long. A function of the second alone, found
 * without counting the blinks before it, so a moment is drawn the same every
 * time, however long he has been at it. None on a still face.
 */
export function petBlinkShut(s: number, since: number, seed: number): number {
  if (s === 0) return 0
  const into = s - since - BLINK_GAP_S
  if (into < 0) return 0
  const k = Math.floor(into / PET_BLINK_EVERY_S)
  for (const n of [k, k - 1]) {
    if (n < 0) continue
    const at = since + BLINK_GAP_S + n * PET_BLINK_EVERY_S + seeded(seed, n, 9) * PET_BLINK_JITTER_S
    const p = (s - at) / PET_BLINK_S
    if (p >= 0 && p <= 1) return p < 0.5 ? p * 2 : (1 - p) * 2
  }
  return 0
}

/** Where his eyes look on the glass in a drawing: the way he faces, walking or turned (rows 1 and 2), else ahead. */
export function lookOf(row: number): number {
  return row === 1 ? 1 : row === 2 ? -1 : 0
}

/** A drawing of his, and its screen in his drawing's pixels (none where the table has none). */
export interface PetScreenCell {
  readonly row: number
  readonly column: number
  readonly rect: ScreenRect | undefined
}

/**
 * SMOOTHER LIFTS (2026-10-05). Colin, of Codex Buddy: *"maybe try and smooth
 * out the codex bro animations ... the original was just very choppy"*. His
 * maker drew a lift in three to five drawings, each held 120 to 520 ms, and
 * one melted into the next in at most 80 ms: so he snapped from pose to pose.
 * Now each drawing melts into the next over most of the time it is held
 * (BUDDY_MELT), eased in and out, so a lift reads as one movement; and his
 * body has weight between them: each new pose lands with a small settle about
 * his feet (BUDDY_SETTLE), and while he moves he breathes. His screen goes
 * with him: it is drawn in the same transform.
 */
/** A drawing melts into the next over this share of the time it is held, at most BUDDY_MELT_MAX_MS. */
export const BUDDY_MELT = 0.6
export const BUDDY_MELT_MAX_MS = 260
/** A new pose lands: squashed this share of his height, easing out over this long. */
export const BUDDY_SETTLE = { depth: 0.022, seconds: 0.18 }
/** While he moves, his breath: this share of his height, once every this many seconds. */
export const BUDDY_BREATH = { depth: 0.008, seconds: 2.4 }

/** Eased in and out (smoothstep), 0 to 1. */
function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t))
  return k * k * (3 - 2 * k)
}

/** How his body is drawn this frame, about his feet: squashed (`sy`) and widened (`sx`) for a pose landing and his breath. */
export function buddyBody(s: number, landedAt: number | undefined, moving: boolean): { readonly sx: number; readonly sy: number } {
  if (s === 0) return { sx: 1, sy: 1 }
  const settle = landedAt === undefined ? 0 : BUDDY_SETTLE.depth * (1 - smooth((s - landedAt) / BUDDY_SETTLE.seconds))
  const breath = moving ? BUDDY_BREATH.depth * Math.sin((2 * Math.PI * s) / BUDDY_BREATH.seconds) : 0
  return { sx: 1 + settle * 0.6, sy: 1 - settle + breath }
}

/** What his face is at one second (petScreenConductor): the drawings to draw, the glass the eyes are on, and the eyes. */
export interface PetScreenFrame {
  /** The drawing shown. */
  readonly cell: PetScreenCell
  /** The drawing melting off it, and how much of it is left (1 all, 0 gone). */
  readonly fading: (PetScreenCell & { readonly left: number }) | undefined
  /** Where the eyes are drawn: the glass between the two drawings' as one melts into the other. */
  readonly glass: ScreenRect | undefined
  readonly pair: EyeGlyphs
  readonly motions: readonly [GlyphMotion, GlyphMotion]
  /** How much his eyes are drawn of their height: shut by a change, a blink, or a screen not yet on. */
  readonly squash: number
  /** The same for an eye already shut in sleep: only a change closes it further. */
  readonly closedSquash: number
  readonly light: { readonly lit: string; readonly glow: string }
  /** Where his screen is in switching on (0 to 1), or undefined once it is on. */
  readonly booting: number | undefined
  /** How open his eyes are from switching on: 0 dark, 1 open. */
  readonly opened: number
  /** Where his eyes look on the glass (lookOf). */
  readonly look: number
  /** The move his body is doing (petRoutines.ts). */
  readonly move: string
  /** Nothing on him will change by itself: a face asked to keep still may stop its clock. */
  readonly settled: boolean
  /** The second the pose shown landed, for its settle (buddyBody); undefined, it has not changed since he appeared. */
  readonly landedAt: number | undefined
}

/**
 * WHAT HIS FACE DOES, SECOND BY SECOND (2026-10-05): the pet's own
 * bodyConductor and withGlyphEyes in one, kept apart from the canvas so it
 * can be read frame by frame.
 *
 * His face's changes are a bot screen's (faceChanges): the eyes shut, the new
 * ones and their light come in under the lids, they open. His body answers
 * once they have -- the new move from its start (its set in turn, for one
 * that goes round sets), held where it was until then -- and a glance at a
 * teammate turns him for GLANCE_HOLD_MS. His own blinks fall between changes
 * (petBlinkShut); asked to keep still, he finishes his move, his eyes ease to
 * their loops' rest over EYES_REST_S, and he is settled. `s` is his clock's
 * second, 0 for a still face: its change at once, its move's still drawing,
 * its loops at rest.
 */
export function petScreenConductor(
  face: PetScreenFace,
  seed: number,
  asked: () => PetScreenAsk,
  turnedTo: () => GlanceSide | undefined,
  turns: Map<string, number> = new Map()
): { readonly frame: (s: number) => PetScreenFrame; readonly boot: (at: number) => void } {
  // The second his screen switches on, and for how long (POWER_ON_S, or a change's CRT_FLICK_S); undefined, it is simply on.
  let bootAt: number | undefined
  let bootSpan = POWER_ON_S
  // How many changes his face had begun at the last frame: a new one may come in as a CRT (PetScreenAsk.crt).
  let changesSeen = 0
  const changes = faceChanges(
    () => ({ pair: asked().eyes, tone: asked().phosphor, key: asked().key }),
    () => asked().flash,
    () => bootAt,
    () => bootSpan
  )
  // His body's move, the face key it answers, since when, and from which beat.
  let body: { readonly key: string | undefined; readonly move: Move; readonly from: number; readonly start: number } | undefined
  const begin = (key: string | undefined, move: Move, from: number): void => {
    let start = 0
    const sets = move.sets
    if (sets !== undefined && sets.length > 0) {
      // The first time from a set his seed picks, then each time the next.
      const turn = turns.get(move.name) ?? Math.floor(seeded(seed, 0, 5) * sets.length)
      start = sets[turn % sets.length] ?? 0
      turns.set(move.name, turn + 1)
    }
    body = { key, move, from, start }
  }
  let shown: PetScreenCell | undefined
  let shownKey = ''
  // When the pose shown landed: a new one settles (buddyBody).
  let landedAt: number | undefined
  // The drawing melting off the one shown: from when, and over how long.
  let fading: (PetScreenCell & { readonly at: number; readonly ms: number }) | undefined
  // When his move was done and he was asked to keep still: his eyes ease to rest from there.
  let restingSince: number | undefined
  const frame = (s: number): PetScreenFrame => {
    const change = changes.at(s)
    const showing = changes.shown()
    const now = asked()
    // A change worth looking up for comes in as his screen switching on again, as a bot's does (Bot's CrtChange).
    if (change.count !== changesSeen) {
      changesSeen = change.count
      const kind = s === 0 ? undefined : now.crt?.(showing.key, now.key, change.count)
      if (kind !== undefined) {
        bootAt = s
        bootSpan = kind === 'on' ? POWER_ON_S : CRT_FLICK_S
      }
    }
    // His body answers once his eyes are open on the change: the move asked for the face shown, from its
    // start -- never one asked for a face still to come (asked for before his first frame, he rests until then).
    const answering = now.key === showing.key
    if (body === undefined) begin(showing.key, answering ? now.move : RESTING, s)
    else if (change.open && answering && (body.key !== showing.key || body.move !== now.move)) begin(showing.key, now.move, body.key !== showing.key && s !== 0 ? change.since : s)
    // Begun on a frame drawn still (woken where his clock may not run): it starts when his clock does.
    else if (body.from === 0 && s !== 0) body = { ...body, from: s }
    const moving = body as NonNullable<typeof body>
    const own = moveCellAt(moving.move, (s - moving.from) * 1000, moving.start, s === 0)
    const side = turnedTo()
    const turned = side === undefined ? undefined : glanceBeat(side)
    const row = turned?.row ?? own.row
    const column = turned?.column ?? own.column
    const key = `${String(row)}:${String(column)}`
    if (shown === undefined || shownKey !== key) {
      fading = shown !== undefined && s !== 0 ? { ...shown, at: s, ms: Math.min(BUDDY_MELT_MAX_MS, Math.max(1, own.ms * BUDDY_MELT)) } : undefined
      landedAt = shown !== undefined && s !== 0 && turned === undefined ? s : landedAt
      shown = { row, column, rect: screenAt(face, row, column) }
      shownKey = key
    }
    // Eased: the old drawing lets go slowly, then quickly, then slowly.
    const melted = fading === undefined ? 1 : smooth(((s - fading.at) * 1000) / fading.ms)
    const left = 1 - melted
    if (melted >= 1) fading = undefined
    // His eyes ease to rest once his move is done and he is asked to keep still.
    if (now.rests && (own.settled || s === 0)) restingSince ??= s
    else restingSince = undefined
    const restK = s === 0 ? 1 : restingSince === undefined ? 0 : Math.min(1, (s - restingSince) / EYES_REST_S)
    const pair = showing.pair ?? SCREEN_RESTING_EYES
    const loopAt = (eye: 0 | 1): GlyphMotion => {
      const moved = glyphMotion(pair.join(''), eye, s - change.since)
      if (restK <= 0) return moved
      const rest = glyphMotion(pair.join(''), eye, 0)
      const mix = (from: number, to: number): number => from + (to - from) * restK
      return { dx: mix(moved.dx, rest.dx), dy: mix(moved.dy, rest.dy), sx: mix(moved.sx, rest.sx), sy: mix(moved.sy, rest.sy), shown: restK >= 0.5 ? rest.shown : moved.shown }
    }
    // His own blinks while he moves; asked to keep still, none.
    const blink = now.rests ? 0 : petBlinkShut(s, change.since, seed)
    const phase = bootAt === undefined || s === 0 ? undefined : (s - bootAt) / bootSpan
    const booting = phase === undefined || phase >= 1 ? undefined : Math.max(0, phase)
    const opened = booting === undefined ? 1 : powerOnEyes(booting)
    // The glass the eyes are on: where it is between the drawing melting off and the one shown.
    const from = fading?.rect
    const to = shown.rect
    const t = 1 - Math.max(0, left)
    const glass =
      to === undefined || from === undefined
        ? to
        : { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, w: from.w + (to.w - from.w) * t, h: from.h + (to.h - from.h) * t }
    return {
      cell: shown,
      fading: fading === undefined ? undefined : { row: fading.row, column: fading.column, rect: fading.rect, left },
      glass,
      pair,
      motions: [loopAt(0), loopAt(1)],
      squash: 1 - 0.92 * Math.max(change.shut, blink, 1 - opened),
      closedSquash: 1 - 0.92 * change.shut,
      light: screenLight(showing.tone, changes.flash(), s),
      booting,
      opened,
      look: lookOf(row),
      move: moving.move.name,
      landedAt,
      settled:
        s === 0 ||
        (change.quiet && fading === undefined && blink === 0 && restK >= 1 && booting === undefined && turned === undefined &&
          (landedAt === undefined || s - landedAt >= BUDDY_SETTLE.seconds))
    }
  }
  return {
    frame,
    boot: (at) => {
      bootAt = at
      bootSpan = POWER_ON_S
    }
  }
}

/**
 * The in-betweens made for a sheet's pairs of drawings (petTweens.ts), by the
 * pair, from one to the other: kept for the session for every face wearing
 * that sheet, and made once, a slice at a time, the first time a face moves
 * between the two.
 */
const TWEENS = new WeakMap<CanvasImageSource, Map<string, readonly CanvasImageSource[] | 'making'>>()
const CELLS = new WeakMap<CanvasImageSource, Map<string, Uint8ClampedArray>>()

/** One drawing's pixels, read once. */
function cellPixels(atlas: PetAtlas, row: number, column: number): Uint8ClampedArray | undefined {
  const cells = CELLS.get(atlas.image) ?? new Map<string, Uint8ClampedArray>()
  CELLS.set(atlas.image, cells)
  const key = `${String(row)},${String(column)}`
  const known = cells.get(key)
  if (known !== undefined) return known
  const canvas = document.createElement('canvas')
  canvas.width = atlas.frameWidth
  canvas.height = atlas.frameHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return undefined
  context.drawImage(atlas.image, column * atlas.frameWidth, row * atlas.frameHeight, atlas.frameWidth, atlas.frameHeight, 0, 0, atlas.frameWidth, atlas.frameHeight)
  const pixels = context.getImageData(0, 0, atlas.frameWidth, atlas.frameHeight).data
  cells.set(key, pixels)
  return pixels
}

/** The in-betweens from one drawing to another, if they are ready; asked for, if they are not. */
function tweensFor(atlas: PetAtlas, from: PetScreenCell, to: PetScreenCell): readonly CanvasImageSource[] | undefined {
  const made = TWEENS.get(atlas.image) ?? new Map<string, readonly CanvasImageSource[] | 'making'>()
  TWEENS.set(atlas.image, made)
  const pair = `${String(from.row)},${String(from.column)}>${String(to.row)},${String(to.column)}`
  const known = made.get(pair)
  if (known === 'making') return undefined
  if (known !== undefined) return known
  const a = cellPixels(atlas, from.row, from.column)
  const b = cellPixels(atlas, to.row, to.column)
  if (a === undefined || b === undefined) return undefined
  made.set(pair, 'making')
  const { frameWidth: w, frameHeight: h } = atlas
  const resting = (): boolean => WINDOW_PRESENCE.away() || document.visibilityState === 'hidden'
  const key = tweenKey(a, b)
  // Kept on this computer from a launch before (petTweenStore.ts): drawn from there, and made only when they are not.
  void keptTweens(key)
    .then(async (kept) => {
      if (kept === undefined || kept.length !== TWEEN_MOMENTS.length) return false
      made.set(pair, await Promise.all(kept.map((image) => createImageBitmap(image))))
      return true
    })
    .catch(() => false)
    .then((found) => {
      if (found) return
      runInSlices(
        tweenSteps(a, b, w, h),
        (frames) => {
          const canvases = frames.map((pixels) => {
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0)
            return canvas
          })
          made.set(pair, canvases)
          void Promise.all(canvases.map((canvas) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))))
            .then((images) => {
              const whole = images.filter((image): image is Blob => image !== null)
              if (whole.length === canvases.length) void keepTweens(key, whole)
            })
            .catch(() => undefined)
        },
        undefined,
        resting
      )
    })
  return undefined
}

interface ScreenPetProps {
  readonly pet: PetRef
  readonly atlas: PetAtlas
  readonly face: PetScreenFace
  readonly size: number
  readonly state: PetState
  readonly ask: PetScreenAsk
  readonly still: boolean
  readonly seed: number
  readonly glance?: GlanceSide
  readonly bootKey?: string
  readonly motionPresence?: WindowPresence
}

function ScreenPet({ pet, atlas, face, size, state, ask, still, seed, glance, bootKey, motionPresence = WINDOW_PRESENCE }: ScreenPetProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  // Read at each frame, so a change is performed on the clock he has, never a rebuilt one.
  const asked = useRef(ask)
  asked.current = ask
  const glanced = useRef<{ readonly side: GlanceSide; readonly at: number } | undefined>(undefined)
  const wake = useRef<(() => void) | undefined>(undefined)
  const bootWanted = useRef(false)
  // Each move's turn round its sets (a workout starts each time from its next lift), kept while he is shown.
  const turns = useRef(new Map<string, number>())

  // Declared before the clock's effect, so the very first frame of a screen that switches on is already dark.
  useEffect(() => {
    if (firstBoot(bootKey)) bootWanted.current = true
  }, [bootKey])

  useEffect(() => {
    glanced.current = glance === undefined ? undefined : { side: glance, at: performance.now() }
    wake.current?.()
  }, [glance])

  // Anything new asked of him wakes him.
  const eyesNow = ask.eyes?.join('') ?? ''
  useEffect(() => {
    wake.current?.()
  }, [ask.key, eyesNow, ask.phosphor, ask.flash, ask.move, ask.rests])

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d') ?? null
    if (canvas === null || context === null) return undefined
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const side = Math.max(1, Math.round(size * dpr))
    canvas.width = side
    canvas.height = side
    // The part of his drawing shown (petWindow), and the canvas pixels a pixel of his drawing is.
    const shown = petWindow(size, atlas.frameWidth, atlas.frameHeight)
    const k = side / shown.side
    // What of the window is his drawing (a whole one is wider than he is drawn): its columns and rows.
    const fromX = Math.max(0, shown.left)
    const toX = Math.min(atlas.frameWidth, shown.left + shown.side)
    const fromY = Math.max(0, shown.top)
    const toY = Math.min(atlas.frameHeight, shown.top + shown.side)
    const within = (value: number): number => Math.max(0, Math.min(1, value))
    const body = atlas.body
    anchorToBox(canvas, {
      left: within((body.left * atlas.frameWidth - shown.left) / shown.side),
      top: within((body.top * atlas.frameHeight - shown.top) / shown.side),
      right: within((body.right * atlas.frameWidth - shown.left) / shown.side),
      bottom: within((body.bottom * atlas.frameHeight - shown.top) / shown.side)
    })
    canvas.toggleAttribute('data-pet-dark', atlas.dark)
    const frozen = still || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const conductor = petScreenConductor(
      face,
      seed,
      () => asked.current,
      () => {
        const looking = glanced.current
        return looking !== undefined && performance.now() - looking.at < GLANCE_HOLD_MS ? looking.side : undefined
      },
      turns.current
    )
    let settledFor = 0
    let stop: (() => void) | undefined
    let atOnce = false
    let gone = false
    // Where his feet are on the canvas: his resting paint's bottom, in the window shown.
    const feetY = Math.min(side, (body.bottom * atlas.frameHeight - shown.top) * k)
    const toCanvas = (rect: ScreenRect): ScreenRect => ({ x: (rect.x - shown.left) * k, y: (rect.y - shown.top) * k, w: rect.w * k, h: rect.h * k })
    const paintCell = (cell: PetScreenCell, alpha: number): void => {
      context.globalAlpha = alpha
      context.drawImage(
        atlas.image,
        cell.column * atlas.frameWidth + fromX,
        cell.row * atlas.frameHeight + fromY,
        toX - fromX,
        toY - fromY,
        (fromX - shown.left) * k,
        (fromY - shown.top) * k,
        (toX - fromX) * k,
        (toY - fromY) * k
      )
      if (cell.rect !== undefined) {
        const glass = toCanvas(cell.rect)
        paintGlass(context, glass, face, GLASS_INK * k, 1 / glassUnits(glass))
      }
      context.globalAlpha = 1
    }
    const draw = (): void => {
      // A still face is drawn at second 0 (its change done at once, its loops at rest), a moving one on its own clock.
      const s = frozen || atOnce ? 0 : performance.now() / 1000 + seed * 17
      atOnce = false
      // A screen asked to switch on does so from this frame, a row of them a moment apart (by seed), as a bot's.
      if (bootWanted.current && s !== 0) {
        bootWanted.current = false
        conductor.boot(s + seed * 0.35)
      }
      const now = conductor.frame(s)
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, side, side)
      // His body's weight (buddyBody), about his feet: his drawing and his screen in the one transform.
      const weight = buddyBody(s, now.landedAt, !asked.current.rests)
      context.setTransform(weight.sx, 0, 0, weight.sy, (side / 2) * (1 - weight.sx), feetY * (1 - weight.sy))
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      // Between two drawings, the in-betweens made for them, each melting into the next; until they are made, a melt.
      const tweens = now.fading === undefined || s === 0 ? undefined : tweensFor(atlas, now.fading, now.cell)
      if (now.fading !== undefined && tweens !== undefined) {
        const steps = tweens.length + 1
        const at = Math.min(steps - 1e-6, (1 - now.fading.left) * steps)
        const i = Math.floor(at)
        const into = at - i
        const drawing = (n: number): CanvasImageSource | undefined => (n === steps ? undefined : n === 0 ? undefined : tweens[n - 1])
        const paintTween = (n: number, alpha: number): void => {
          const image = drawing(n)
          if (image === undefined) {
            const cell = n === 0 ? now.fading : now.cell
            if (cell === undefined) return
            context.globalAlpha = alpha
            context.drawImage(atlas.image, cell.column * atlas.frameWidth + fromX, cell.row * atlas.frameHeight + fromY, toX - fromX, toY - fromY, (fromX - shown.left) * k, (fromY - shown.top) * k, (toX - fromX) * k, (toY - fromY) * k)
            context.globalAlpha = 1
            return
          }
          context.globalAlpha = alpha
          context.drawImage(image, fromX, fromY, toX - fromX, toY - fromY, (fromX - shown.left) * k, (fromY - shown.top) * k, (toX - fromX) * k, (toY - fromY) * k)
          context.globalAlpha = 1
        }
        paintTween(i + 1, 1)
        paintTween(i, 1 - into)
        // One glass, where it is between the two drawings'.
        if (now.glass !== undefined) {
          const glass = toCanvas(now.glass)
          paintGlass(context, glass, face, GLASS_INK * k, 1 / glassUnits(glass))
        }
      } else {
        paintCell(now.cell, 1)
        if (now.fading !== undefined) paintCell(now.fading, now.fading.left)
      }
      if (now.glass !== undefined) {
        const glass = toCanvas(now.glass)
        if (now.booting !== undefined) paintPowerOn(context, glass, now.booting, now.light, 1 / glassUnits(glass))
        if (now.opened > 0) paintScreenEyes(context, glass, now.pair, now.motions, now.squash, now.closedSquash, now.light, now.look)
      }
      canvas.dataset.cell = `${String(now.cell.row)},${String(now.cell.column)}`
      canvas.dataset.eyes = now.pair.join('')
      /*
       * ASKED TO KEEP STILL, HE RESTS ONCE HE HAS SETTLED (Bot's
       * SETTLED_FRAMES): his change performed, his move done, his eyes at rest,
       * no blink, nothing melting. His clock stops there, the frame he rests in
       * left drawn, and costs nothing until something new wakes him.
       */
      settledFor = asked.current.rests && now.settled ? settledFor + 1 : 0
      if (settledFor >= SETTLED_FRAMES && stop !== undefined) {
        stop()
        stop = undefined
      }
    }

    if (frozen) {
      draw()
      wake.current = draw
      return () => {
        wake.current = undefined
      }
    }
    let onScreen = true
    // The clock, from where he rests: it picks up with no jump for the time it was stopped.
    const run = (): void => {
      if (stop !== undefined || gone) return
      settledFor = 0
      // Woken where his clock may not run (Bot's): that one frame is drawn still, his new face at once.
      atOnce = motionPresence.away()
      stop = startBotClock(draw, () => undefined, () => onScreen && document.visibilityState !== 'hidden', undefined, motionPresence)
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
    }
    // Something new asked of him is performed on the running clock (wake), never a rebuilt one.
  }, [atlas, face, size, still, seed, motionPresence])

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-face="pet"
      data-pet={pet.id}
      data-pet-state={state}
      data-screen="on"
      data-move={ask.move.name}
      style={{ display: 'block', flex: 'none', width: size, height: size }}
    />
  )
}
