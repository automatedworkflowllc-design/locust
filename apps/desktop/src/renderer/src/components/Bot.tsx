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

import { useTerminalFaces } from '../botLook.js'
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
  /** Each eye drawn as a code glyph, left then right (`eyeGlyphs`): undefined, the rig's own eyes. */
  readonly eyes?: EyeGlyphs
}

/** The glyph each eye becomes, left and right. */
export type EyeGlyphs = readonly [string, string]

/**
 * EYES THAT ARE CODE (0.559). Colin, 2026-10-02: "I kind of like what the
 * codex mascot does with the eyes making them different coding lines. Should
 * we implement that to all of our teammates?" The rig draws each eye as one
 * stroke at that eye's own centre, already carried round the head's sphere and
 * squashed for a blink -- so the stroke is swapped for a glyph there, in the
 * face's ink, and the glyph turns, glances and blinks as the eye did. The eyes
 * are told apart by a stand-in ink only the face uses.
 */
export const GLYPH_INK = '#010203'

/**
 * DRAWN, NOT TYPED (0.560). Colin, 2026-10-03, beside the codex mascot's
 * sheet: "the eyes for this one look thick and filled out, not like we just
 * gave them text for eyes". 0.559 set each glyph in a monospace font, and it
 * read as a letter pasted on a face. Now each is a few strokes as thick as
 * the eye it replaces, round at every end and corner -- the rig's own eye is
 * one round stroke 12.6 across, so a glyph stays the eye's weight -- in eye
 * units, the eye's centre at 0, y down. A blink squashes the strokes' places,
 * never their weight, so a blinking glyph is a line and not a sliver.
 */
interface GlyphShape {
  /** Polylines, each a run of x, y pairs. */
  readonly lines: readonly (readonly number[])[]
  /** A ring, its radius. */
  readonly ring?: number
  /** Stroke weight. */
  readonly weight: number
}

export const GLYPH_SHAPES: Readonly<Record<string, GlyphShape>> = {
  '>': { lines: [[-3.3, -5.4, 3.5, 0, -3.3, 5.4]], weight: 4.6 },
  '<': { lines: [[3.3, -5.4, -3.5, 0, 3.3, 5.4]], weight: 4.6 },
  _: { lines: [[-4.6, 4.4, 4.6, 4.4]], weight: 4.6 },
  '-': { lines: [[-4.8, 0.4, 4.8, 0.4]], weight: 4.6 },
  '^': { lines: [[-5.2, 2.8, 0, -2.6, 5.2, 2.8]], weight: 4.4 },
  x: { lines: [[-3.9, -3.9, 3.9, 3.9], [3.9, -3.9, -3.9, 3.9]], weight: 4.2 },
  '|': { lines: [[0, -4.9, 0, 4.9]], weight: 5.4 },
  o: { lines: [], ring: 3.9, weight: 3.8 },
  // A round eye, wide awake: one stroke of no length, its round cap a dot.
  '•': { lines: [[0, -0.01, 0, 0.01]], weight: 8.4 },
  // A block cursor: a short, fat bar, round at both ends.
  '▮': { lines: [[0, -3.3, 0, 3.3]], weight: 7 }
}

/** Where a glyph is this moment, in eye units: moved, stretched, or not lit at all. */
export interface GlyphMotion {
  readonly dx: number
  readonly dy: number
  readonly sx: number
  readonly sy: number
  readonly shown: boolean
}

const AT_REST: GlyphMotion = { dx: 0, dy: 0, sx: 1, sy: 1, shown: true }
const frac = (n: number): number => n - Math.floor(n)
/** 0 to 1 and back over `length` seconds starting at `from` of a cycle, eased in and out. */
function hump(phase: number, from: number, length: number): number {
  const p = (phase - from) / length
  return p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p) ** 2
}

/**
 * EYES THAT ARE ALIVE (0.560). Colin, 2026-10-03, of 0.559: "it looks like
 * the eyes are just staying as flat lines on not cycling through any effects
 * so they dont look alive". The mascot's sheet is frames, each eye doing
 * something; here each pair has its own small loop, on the rig's clock (a
 * still bot is drawn at second 0, which is each loop's rest):
 *
 * - `>_` at work: the cursor types forward in a burst, then blinks where it
 *   stopped, and the prompt nudges on with each burst.
 * - `--` in thought: the dashes drift side to side, looking up a little, and
 *   now and then pull in to dots, mulling, and back.
 * - `^^` done: a happy bob.
 * - `xx` stuck: a shudder now and then.
 * - `||` a screen at rest: the rig's blinks and glances, which squash and
 *   move the bars.
 */
export function glyphMotion(pair: string, eye: 0 | 1, seconds: number): GlyphMotion {
  // A still bot: each pair as it rests.
  if (seconds === 0) return AT_REST
  switch (pair) {
    case '>▮': {
      // A burst of typing, then the cursor blinks where it stopped; the prompt leans into each burst.
      const phase = frac(seconds / 2.4)
      const typing = phase < 0.34
      const keystroke = typing ? frac((phase * 2.4) / 0.15) : 1
      const pop = typing ? hump(keystroke, 0, 0.5) : 0
      if (eye === 0) return { ...AT_REST, dx: 0.9 * hump(phase, 0, 0.34), sx: 1 + 0.08 * pop }
      const steps = typing ? Math.floor((phase * 2.4) / 0.15) % 4 : 3
      const blinkOn = typing || frac((phase * 2.4 - 0.82) / 0.8) < 0.56
      return { dx: steps * 0.85 - 1.3, dy: 0, sx: 1 + 0.16 * pop, sy: 1 - 0.1 * pop, shown: blinkOn }
    }
    case '••': {
      // Wide awake: looking up and about, then the two dots bounce in turn, a thought loading.
      const cycle = 4.2
      const t = frac(seconds / cycle) * cycle
      if (t < 2.1) {
        const glances: readonly (readonly [number, number])[] = [[-1.6, -1.5], [1.6, -1.4], [0.4, -1.8], [-1.6, -1.5]]
        const at = (t / 2.1) * 3
        const from = glances[Math.floor(at)] ?? [0, 0]
        const to = glances[Math.floor(at) + 1] ?? from
        // Eyes dart, then hold: most of each step is spent looking.
        const p = Math.min(1, frac(at) / 0.22)
        const ease = p * p * (3 - 2 * p)
        const squint = hump(t, 1.35, 0.28)
        return { dx: from[0] + (to[0] - from[0]) * ease, dy: from[1] + (to[1] - from[1]) * ease, sx: 1 + 0.08 * squint, sy: 1 - 0.42 * squint, shown: true }
      }
      // The loader: each dot rises and falls, the right half a beat after the left.
      const beat = Math.max(0, Math.sin((t - 2.1) * Math.PI * 2.4 - eye * Math.PI * 0.6))
      // Eased in from the last glance (up and left), so the eyes never jump.
      const p = Math.min(1, (t - 2.1) / 0.25)
      const settle = p * p * (3 - 2 * p)
      return {
        dx: -1.6 * (1 - settle),
        dy: -1.5 * (1 - settle) + (-0.5 - 1.3 * beat) * settle,
        sx: 1 - 0.12 * beat * settle,
        sy: 1 + 0.12 * beat * settle,
        shown: true
      }
    }
    case '^^': {
      const bob = Math.max(0, Math.sin(seconds * 4.2 + eye * 0.35))
      return { dx: 0, dy: -1.5 * bob, sx: 1 + 0.06 * bob, sy: 1 - 0.08 * bob, shown: true }
    }
    case 'xx': {
      const shudder = hump(frac(seconds / 3), 0, 0.14)
      return { ...AT_REST, dx: 1.1 * shudder * Math.sin(seconds * 70) }
    }
    default:
      return AT_REST
  }
}

/** The rig's eye weight is 2.8 shut and 12.6 open, so its weight says how open the eye is. */
export function eyeOpenness(lineWidth: number): number {
  return Math.max(0, Math.min(1, (lineWidth - 2.8) / 9.8))
}

/**
 * A SCREEN FOR A FACE (0.560). Colin, 2026-10-03, of the codex mascot: "he
 * also seems to have a screen for a face". A shape marked `screen` wears a
 * dark visor of its own hue, its eyes lit glyphs on it in a bright tint of
 * the same hue with a little glow -- our plastic and our colours, not the
 * mascot's navy and cyan. The visor is laid ON the head's sphere, point by
 * point, by the projection the rig gives its eyes, so it turns and curves
 * with the head; and the rig skips the face when the head is turned away, so
 * the back of the head is plain, as the mascot's is.
 */
export interface VisorBox {
  readonly halfWidth: number
  readonly halfHeight: number
  readonly corner: number
  /** Its centre's height on the face, in face units, y down. */
  readonly y: number
}

/** Prompt's screen, the one drawn for it; a face with a mouth takes one that reaches down over the mouth. */
export const EYES_VISOR: VisorBox = { halfWidth: 27, halfHeight: 17.5, corner: 12, y: 1.5 }
export const MOUTH_VISOR: VisorBox = { halfWidth: 27, halfHeight: 21.5, corner: 12, y: 5.5 }

/**
 * EVERY SHAPE'S OWN SCREEN (0.561). Colin, 2026-10-03: "maybe im realizing
 * they might all need a screen for a face, we can have it togglable in
 * settings, terminal face". Twenty-two outlines, from a wide droid to a
 * swarm's small head, so one screen size cannot fit them all: the screen is
 * shrunk, from Prompt's, until it sits inside the body with a margin all
 * round, tested point by point against the outline itself. `inside` answers
 * for a point in the outline's own 0 to 100 units; the face's unit is
 * faceScale of those, centred on faceX, faceY.
 */
export function fitVisor(
  inside: (x: number, y: number) => boolean,
  faceX: number,
  faceY: number,
  faceScale: number,
  base: VisorBox,
  margin = 3
): VisorBox {
  const scaled = (k: number): VisorBox => ({ halfWidth: base.halfWidth * k, halfHeight: base.halfHeight * k, corner: base.corner * k, y: base.y })
  for (let k = 1; k > 0.5; k -= 0.025) {
    const box = scaled(k)
    const room = { ...box, halfWidth: box.halfWidth + margin, halfHeight: box.halfHeight + margin, corner: box.corner + margin }
    if (visorOutline(room).every(([x, y]) => inside(faceX + x * faceScale, faceY + y * faceScale))) return box
  }
  return scaled(0.5)
}
/** The rig's face sphere, and the eye's turn past which the left eye is out of sight (asin(12.5 / 30) + 90deg). */
const SPHERE = 30
const LEFT_EYE_HIDDEN_AT = -1.12
/**
 * How far a screen turns with its head. Laid on the head's own sphere at the
 * full turn, a screen wrapped past the body's turned outline at the far side
 * and that eye was cut away with it -- at a three-quarter turn one eye was
 * gone in every shape (_tools/look-screen-poses.mjs). A little over half the
 * turn keeps both eyes and the screen's far edge on the face, and still reads
 * as a screen set into a turning head.
 */
const SCREEN_TURN = 0.55
/** How much larger a lit glyph is than an inked one: a screen's eyes fill it, as the mascot's do. */
const SCREEN_GLYPH_SCALE = 1.3
/** An inked glyph a little larger than the eye, and heavier: a dot is round and full, and a stroke of the dot's size reads thinner. */
const INKED_GLYPH_SCALE = 1.12

/** A rounded rectangle's outline in face units, evenly spaced, to be laid on the sphere. */
export function visorOutline(box: VisorBox): readonly (readonly [number, number])[] {
  const { halfWidth: w, halfHeight: h, corner: r, y } = box
  const points: [number, number][] = []
  const edge = (ax: number, ay: number, bx: number, by: number, steps: number): void => {
    for (let i = 0; i < steps; i += 1) points.push([ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps])
  }
  const arc = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i < 6; i += 1) {
      const t = from + (i / 6) * (Math.PI / 2)
      points.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
    }
  }
  edge(-w + r, y - h, w - r, y - h, 8)
  arc(w - r, y - h + r, -Math.PI / 2)
  edge(w, y - h + r, w, y + h - r, 4)
  arc(w - r, y + h - r, 0)
  edge(w - r, y + h, -w + r, y + h, 8)
  arc(-w + r, y + h - r, Math.PI / 2)
  edge(-w, y + h - r, -w, y - h + r, 4)
  arc(-w + r, y - h + r, Math.PI)
  return points
}

/** A point of the face carried round the head's sphere, as the rig carries its eyes; past the edge, held at it. */
export function onSphere(x: number, y: number, yaw: number, pitch: number): readonly [number, number] {
  const at = sphereAt(x, y, yaw, pitch)
  return [at.x, at.y]
}

/** Where a point of the face lands, how much it is foreshortened across and down, and how far it faces us (1 head on, 0 at the edge). */
export function sphereAt(
  x: number,
  y: number,
  yaw: number,
  pitch: number
): { readonly x: number; readonly y: number; readonly sx: number; readonly sy: number; readonly z: number } {
  const across = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.asin(Math.max(-1, Math.min(1, x / SPHERE))) + yaw))
  const down = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.asin(Math.max(-1, Math.min(1, -y / SPHERE))) + pitch))
  return {
    x: SPHERE * Math.sin(across) * Math.cos(down),
    y: -SPHERE * Math.sin(down),
    sx: Math.cos(across),
    sy: Math.cos(down),
    z: Math.cos(across) * Math.cos(down)
  }
}

/** What the rig's pose says about the head this frame: its turn, and where its eyes look (face units). */
export interface FacePose {
  readonly yaw: number
  readonly pitch: number
  readonly lookX: number
  readonly lookY: number
}

/** A colour as red, green, blue: `#rgb`, `#rrggbb`, or `rgb()` as the library's shade gives it. */
export function hexRgb(hex: string): readonly [number, number, number] {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(hex.trim())
  if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
  const n = Number.parseInt(full, 16)
  return Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A colour of the same hue at this saturation and lightness, 0 to 1. */
export function sameHue(color: string, saturation: number, lightness: number, alpha = 1): string {
  return `hsla(${Math.round(hueOf(color))}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%, ${alpha})`
}

/** A colour's hue in degrees, from `hsl()` as the library's shade gives it, or from a hex or `rgb()`. */
export function hueOf(color: string): number {
  const hsl = /^hsla?\(\s*(-?[\d.]+)/i.exec(color.trim())
  if (hsl !== null) return ((Number(hsl[1]) % 360) + 360) % 360
  const [r, g, b] = hexRgb(color).map((c) => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let hue = 0
  if (d > 0) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (hue * 60 + 360) % 360
}

export interface EyePaint {
  readonly ink: string
  /** The body colour, for a screen's own tints; undefined, the face is no screen. */
  readonly screenOf: string | undefined
  /** Device pixels a face unit spans, for the glow. */
  readonly pixelsPerUnit: number
  /** The screen's size on this face; Prompt's when not given. */
  readonly visor?: VisorBox
  /** Where the eyes sit on the face, in face units, y down: the rig's 1, or -3.5 above a mouth. */
  readonly eyeY?: number
}

/**
 * The context's own `stroke`, `fill` and `translate`, shadowed on this one
 * context (cheaper than wrapping every call of every frame). `frame()` is
 * called before each frame: the left eye is drawn first, and an eye turned out
 * of sight is not drawn at all, so the count starts again each frame from the
 * stroke's place. The rig moves to each eye with one translate from the face's
 * own transform, so the transform before the last translate is the face's.
 */
export function withGlyphEyes(
  context: CanvasRenderingContext2D,
  eyesNow: () => EyeGlyphs | undefined,
  paint: EyePaint
): { readonly frame: (pose: FacePose, seconds: number) => void } {
  // From the prototype, never the context: a second effect on the same canvas must not stack on the first.
  const own = Object.getPrototypeOf(context) as CanvasRenderingContext2D
  const stroke = own.stroke.bind(context) as (...args: unknown[]) => void
  const fill = own.fill.bind(context) as (...args: unknown[]) => void
  const translate = own.translate.bind(context)
  const screen = paint.screenOf
  const box = paint.visor ?? EYES_VISOR
  const visorShape = visorOutline(box)
  const lit = screen === undefined ? paint.ink : sameHue(screen, 0.95, 0.8)
  const glow = screen === undefined ? undefined : sameHue(screen, 1, 0.62, 0.85)
  const visorTop = screen === undefined ? '' : sameHue(screen, 0.42, 0.17)
  const visorBottom = screen === undefined ? '' : sameHue(screen, 0.5, 0.08)
  let drawn = 0
  let yaw = 0
  let pitch = 0
  let look = { x: 0, y: 0 }
  let seconds = 0
  let leftHidden = false
  let face: DOMMatrix | undefined
  if (screen !== undefined) {
    ;(context as unknown as { translate: (x: number, y: number) => void }).translate = (x, y) => {
      face = context.getTransform()
      translate(x, y)
    }
  }
  // The visor's outline this frame, on the sphere: drawn once, and clipped to again for each eye.
  let outline: (readonly [number, number])[] = []
  const trace = (): void => {
    context.beginPath()
    outline.forEach(([px, py], i) => {
      if (i === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    })
    context.closePath()
  }
  const visor = (): void => {
    if (face === undefined) return
    outline = visorShape.map(([x, y]) => onSphere(x, y, yaw, pitch))
    context.save()
    context.setTransform(face)
    context.globalAlpha = 1
    trace()
    const top = onSphere(0, box.y - box.halfHeight, yaw, pitch)[1]
    const bottom = onSphere(0, box.y + box.halfHeight, yaw, pitch)[1]
    const ground = context.createLinearGradient(0, top, 0, bottom)
    ground.addColorStop(0, visorTop)
    ground.addColorStop(1, visorBottom)
    context.fillStyle = ground
    fill()
    // The glass: a soft sheen across its top, and a fine lit rim.
    context.clip()
    const sheen = context.createLinearGradient(0, top, 0, top + box.halfHeight)
    sheen.addColorStop(0, 'rgba(255,255,255,0.13)')
    sheen.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = sheen
    context.fillRect(-SPHERE, top, SPHERE * 2, box.halfHeight)
    context.strokeStyle = 'rgba(255,255,255,0.16)'
    context.lineWidth = 1.6
    stroke()
    context.restore()
  }
  /** One glyph at the current transform (the eye's centre), its strokes moved and squashed, its weight kept. */
  const drawGlyph = (shape: GlyphShape, motion: GlyphMotion, scale: number, squash: number): void => {
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = shape.weight * scale
    context.strokeStyle = lit
    if (glow !== undefined) {
      context.shadowColor = glow
      context.shadowBlur = 3.2 * paint.pixelsPerUnit
    }
    context.beginPath()
    for (const line of shape.lines) {
      for (let i = 0; i < line.length; i += 2) {
        const x = ((line[i] ?? 0) * motion.sx + motion.dx) * scale
        const y = ((line[i + 1] ?? 0) * motion.sy * squash + motion.dy) * scale
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
    }
    if (shape.ring !== undefined) {
      const r = shape.ring * scale
      context.ellipse(motion.dx * scale, motion.dy * scale, r * motion.sx, Math.max(0.3, r * motion.sy * squash), 0, 0, Math.PI * 2)
    }
    stroke()
  }
  /**
   * A SCREEN'S EYES ARE PLACED ON THE SCREEN. The rig moves its eyes for a
   * glance further than a screen is wide, so on a turned head they slid off
   * its edge and were cut away -- a ghost looking aside had no eyes at all
   * (0.561, looked at frame by frame). So on a screen both eyes are drawn
   * here, at the first eye the rig draws: spaced to the screen's own width,
   * carried round the same sphere as the screen, and a glance moves them only
   * as far as the screen has room for.
   */
  const screenEyes = (open: number): void => {
    visor()
    if (face === undefined) return
    const pair = eyesNow() ?? SCREEN_RESTING_EYES
    const k = Math.max(0.55, Math.min(1, box.halfWidth / EYES_VISOR.halfWidth))
    const scale = SCREEN_GLYPH_SCALE * k
    const spread = 12.5 * k
    const across = Math.max(0, box.halfWidth - spread - 6.5 * scale)
    const down = Math.max(0, box.halfHeight - 6.5 * scale)
    const lookX = Math.max(-across, Math.min(across, look.x * 0.9))
    const lookY = Math.max(box.y - down, Math.min(box.y + down, (paint.eyeY ?? 1) + look.y * 0.5))
    const squash = 0.08 + 0.92 * open
    for (const eye of [0, 1] as const) {
      const shape = GLYPH_SHAPES[pair[eye]] ?? GLYPH_SHAPES['•']
      const motion = glyphMotion(pair.join(''), eye, seconds)
      if (shape === undefined || !motion.shown) continue
      const at = sphereAt((eye === 0 ? -spread : spread) + lookX, lookY, yaw, pitch)
      if (at.z < 0.05) continue
      context.save()
      context.setTransform(face)
      context.globalAlpha = Math.min(1, at.z * 5)
      trace()
      context.clip()
      // The context's own translate: the shadowed one would take this for the face's.
      translate(at.x, at.y)
      context.scale(Math.max(0.02, at.sx), Math.max(0.02, at.sy))
      drawGlyph(shape, motion, scale, squash)
      context.restore()
    }
  }
  const glyphAt = (args: unknown[]): void => {
    // The rig draws the left eye first; an eye out of sight is not drawn at all.
    const left = drawn === 0 && !leftHidden
    drawn += 1
    if (screen !== undefined) {
      if (drawn === 1) screenEyes(eyeOpenness(context.lineWidth))
      return
    }
    const pair = eyesNow()
    const shape = GLYPH_SHAPES[pair?.[left ? 0 : 1] ?? '']
    if (shape === undefined) {
      // Not a glyph we draw: the rig's own eye, in the face's colour.
      context.strokeStyle = lit
      return stroke(...args)
    }
    const squash = 0.08 + 0.92 * eyeOpenness(context.lineWidth)
    const motion = glyphMotion(pair?.join('') ?? '', left ? 0 : 1, seconds)
    if (!motion.shown) return
    context.save()
    drawGlyph(shape, motion, INKED_GLYPH_SCALE, squash)
    context.restore()
  }
  ;(context as unknown as { stroke: (...args: unknown[]) => void }).stroke = (...args) => {
    if (String(context.strokeStyle).toLowerCase() === GLYPH_INK) return glyphAt(args)
    return stroke(...args)
  }
  ;(context as unknown as { fill: (...args: unknown[]) => void }).fill = (...args) => {
    // A mouth is drawn in the face's ink too: it keeps the real one, or is lit on a screen, and kept on it.
    if (String(context.fillStyle).toLowerCase() !== GLYPH_INK) return fill(...args)
    if (screen === undefined || face === undefined || outline.length === 0) {
      context.fillStyle = paint.ink
      return fill(...args)
    }
    context.fillStyle = lit
    const mouth = context.getTransform()
    context.save()
    context.setTransform(face)
    trace()
    context.clip()
    context.setTransform(mouth)
    fill(...args)
    context.restore()
    return undefined
  }
  return {
    frame: (pose, s) => {
      drawn = 0
      seconds = s
      // The screen and its eyes turn with the head, but not as far (SCREEN_TURN).
      yaw = pose.yaw * SCREEN_TURN
      pitch = pose.pitch * SCREEN_TURN
      look = { x: pose.lookX, y: pose.lookY }
      leftHidden = pose.yaw < LEFT_EYE_HIDDEN_AT
      face = undefined
      outline = []
    }
  }
}

/** A screen's eyes when nothing else is asked of them: two lit bars, as the mascot rests. */
export const SCREEN_RESTING_EYES: EyeGlyphs = ['|', '|']

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
export interface Outline {
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
  /** Its face is a dark screen with lit eyes. */
  readonly screen: boolean
}

/** Each shape's screen, by shape and face, measured once against its outline. */
const VISORS = new Map<string, VisorBox>()

export function visorOf(outline: Outline, face: BotAvatarFace, path: Path2D): VisorBox {
  const base = face === 'mouth' ? MOUTH_VISOR : EYES_VISOR
  // Prompt's screen was drawn for it; the rest are fitted.
  if (outline.screen) return base
  const key = `${outline.key}|${face}`
  const known = VISORS.get(key)
  if (known !== undefined) return known
  const measure = document.createElement('canvas').getContext('2d')
  if (measure === null) return base
  const fitted = fitVisor((x, y) => measure.isPointInPath(path, x, y), outline.faceX, outline.faceY, outline.faceScale, base)
  VISORS.set(key, fitted)
  return fitted
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
      faceScale: shape.faceScale,
      screen: shape.screen === true
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
    faceScale: preset.faceScale,
    screen: false
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
  glance,
  eyes
}: BotProps): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const rig = useRef<BotAvatarSim | null>(null)
  const glyphs = useRef(eyes)
  // A screen always has lit eyes: its resting ones when nothing else is asked.
  // Terminal faces on (Settings > Appearance), every shape wears one.
  const terminal = useTerminalFaces()
  const screen = outlineOf(type).screen || terminal
  glyphs.current = eyes ?? (screen ? SCREEN_RESTING_EYES : undefined)
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
    // Read at each frame, so a teammate's eyes change with what it does without restarting its rig.
    const painter = withGlyphEyes(context, () => glyphs.current, {
      ink,
      screenOf: screen ? body : undefined,
      visor: visorOf(outline, face ?? outline.face, path),
      // The rig's eye height for each face (its own `eyes: 1, mouth: -3.5`).
      eyeY: (face ?? outline.face) === 'mouth' ? -3.5 : 1,
      // The face is drawn at size / 100 a unit (times its own scale), at dpr device pixels a CSS pixel.
      pixelsPerUnit: (size / 100) * outline.faceScale * dpr
    })
    const draw = (): void => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, side, side)
      // A still bot is drawn at its loops' rest; a moving one on its own clock, offset so a row does not move in unison.
      painter.frame(sim.pose, still ? 0 : performance.now() / 1000 + seed * 17)
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
        ink: glyphs.current === undefined ? ink : GLYPH_INK,
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
  }, [type, size, color, face, seed, paused, paused ? state : undefined, jumpEvery, paused ? eyes?.join('') : undefined, screen])

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
      // What it wears, for a drive to read beside the pixels: a screen, or its own eyes.
      data-face={screen ? 'screen' : 'eyes'}
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
