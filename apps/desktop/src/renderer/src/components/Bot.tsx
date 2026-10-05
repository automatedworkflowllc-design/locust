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
import type { BotAvatarFace, BotAvatarPose, BotAvatarState, BotAvatarType } from 'bot-avatars'
import { anchorsOf, anchorVariables, paintedBounds, type BodyBox } from '../botAnchors.js'

import { screenSuits } from '../../../shared/avatar.js'
import { usePlush, useTerminalFaces } from '../botLook.js'
import { LOCUST_BOTS, isLocustBot } from '../locustBots.js'
import type { LocustBotType } from '../locustBots.js'
import { WINDOW_PRESENCE } from '../windowPresence.js'
import type { WindowPresence } from '../windowPresence.js'

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

/**
 * A finished teammate's hop: no turn in it, and a glad landing -- the
 * library's `bouncy` squash and rise, which overshoot into a stretch and
 * settle, where its default `pulse` presses and recovers flat (2026-10-05).
 */
export const GLAD_HOP = { spin: 0, squashEase: 'bouncy', riseEase: 'bouncy' } as const

export interface BotProps {
  readonly type: BotType
  readonly size: number
  /** A resolved colour. Undefined: the shape's own. */
  readonly color?: string
  readonly state?: BotAvatarState
  /** Still, in the state's resting pose. */
  readonly paused?: boolean
  /** Hold the current frame and rig while a containing cover rests. */
  readonly motionPresence?: WindowPresence
  readonly face?: BotAvatarFace
  readonly seed?: number
  /** Eyes follow a nearby pointer, and a click makes it hop. */
  readonly interactive?: boolean
  /** Eyes follow a nearby pointer, with no click of their own: a face that has noticed you (TeammateBot). */
  readonly follows?: boolean
  /** Seconds between idle jumps, give or take; 0 for none (the library's `jumpEvery`). */
  readonly jumpEvery?: number
  /** Hops once, straight up, each time this turns true: a moment, not a state. */
  readonly hop?: boolean
  /** Looks this way for a moment (GLANCE_HOLD_MS) each time it is given, then back. */
  readonly glance?: Glance
  /** Each eye drawn as a code glyph, left then right (`eyeGlyphs`): undefined, the rig's own eyes. */
  readonly eyes?: EyeGlyphs
  /** What a screen's eyes glow (PHOSPHOR); cyan when not given. A face with no screen ignores it. */
  readonly phosphor?: Phosphor
  /** A colour a screen's eyes flash as this arrives, fading back to their own (FLASH_S): green as it finishes. */
  readonly flash?: Phosphor
  /**
   * Wears a screen for a face while Terminal faces is on: true or false as the
   * teammate chose, undefined for whatever suits its shape (`screenSuits`).
   * Prompt always does: the screen is its face.
   */
  readonly screen?: boolean
  /** How it feels this moment (BotMood): a body language on top of its motion, eased in and out. */
  readonly mood?: BotMood
  /**
   * What it is doing (a new activity): each time this changes the face
   * performs the change (FaceChange) -- one blink, the new eyes under it, then
   * its mood and its hop -- even when its eyes stay the same. The change reads
   * as noticed.
   */
  readonly blinkKey?: string
  /**
   * Who this face is, for its screen's power-on (POWER_ON_S): a screen
   * switches on the first time a face of this key is drawn in a session, and
   * no other time. Undefined, it is simply on.
   */
  readonly bootKey?: string
  /** Which of its changes come in as the screen switching on again (CrtRule); undefined, every one blinks. */
  readonly crt?: CrtRule
}

/** The faces whose screens have switched on this session (BotProps.bootKey). */
const BOOTED = new Set<string>()

/** Whether this face's screen switches on now: the first time it is asked, this session (BotProps.bootKey). A pet's screen asks too. */
export function firstBoot(bootKey: string | undefined): boolean {
  if (bootKey === undefined || BOOTED.has(bootKey)) return false
  BOOTED.add(bootKey)
  return true
}

/**
 * HOW A TEAMMATE FEELS, IN ITS BODY (2026-10-05). Colin, of bloub's catalog:
 * "is there any other physics/movement/emotions/animations ... that can be
 * added to teammates reliably" -- "we can take all your suggestions". Each is
 * bloub's, read in its source and fitted to what a teammate is doing:
 *
 * - `curious`, waiting on you: the head tips to one side and stays there.
 *   bloub's curious face is a 15 degree roll ("it is the roll that carries
 *   curiosity"); the whole silhouette leans, so it reads in the sidebar.
 * - `perked`, a message just arrived: the head lifts a little, as at a sound.
 * - `glad`, just finished: the eyes narrow in a smile (the rig's own laugh) as
 *   it hops, and the hop lands with a bounce.
 *
 * A mood is a pose added to the rig's, never a motion of its own: it eases in
 * with glanceEase and out the same way, and a still bot simply wears it.
 */
export type BotMood = 'curious' | 'perked' | 'glad'

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
  /** An eye already shut (asleep): the rig's own closing does not flatten it further. */
  readonly closed?: true
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
  // An eye shut in sleep: a soft arc, low in the middle, as a contented sleeper's (0.562).
  c: { lines: [[-4.6, -0.9, -2.6, 1.0, 0, 1.7, 2.6, 1.0, 4.6, -0.9]], weight: 3.8, closed: true },
  // A round eye, wide awake: one stroke of no length, its round cap a dot.
  '•': { lines: [[0, -0.01, 0, 0.01]], weight: 8.4 },
  // A block cursor: a short, fat bar, round at both ends.
  '▮': { lines: [[0, -3.3, 0, 3.3]], weight: 7 }
}

const DOT_GLYPH = GLYPH_SHAPES['•']
const DASH_GLYPH = GLYPH_SHAPES['-']

/**
 * A DOT BLINKS INTO A DASH (2026-10-05). A blink squashes a glyph's places,
 * never its weight -- but a dot is one stroke of no length, so it had none to
 * squash, and the thinking dots never blinked: they stared. Now, as it shuts,
 * a dot draws out into the screen's own dash and back: as wide as `-` and as
 * heavy, so a shut dot is the closed eye a screen already draws, never a
 * sliver. bloub's wink is the same idea -- its shut eye "is not the open eye
 * squashed: it is a horizontal dash wider than the open eye". `closing` is 0
 * open to 1 shut.
 */
export function blinkingDot(closing: number): GlyphShape {
  const dot = DOT_GLYPH ?? { lines: [[0, -0.01, 0, 0.01]], weight: 8.4 }
  const dash = DASH_GLYPH ?? { lines: [[-4.8, 0.4, 4.8, 0.4]], weight: 4.6 }
  const c = Math.max(0, Math.min(1, closing))
  const half = 4.8 * c
  return { lines: [[-half, 0.4 * c - 0.01 * (1 - c), half, 0.4 * c + 0.01 * (1 - c)]], weight: dot.weight + (dash.weight - dot.weight) * c }
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
 *
 * EACH LOOP ON ITS STATE'S OWN CLOCK (2026-10-05). `seconds` is how long the
 * state has been shown (FaceChange.since), so a loop starts where its state
 * begins: a teammate that gets stuck shudders as it gets stuck, one that
 * starts work types its first burst. Read on the bot's clock, as it was, each
 * started wherever that clock happened to be. So second 0 is where every loop
 * sets off from, and it is where a still bot rests: the loop moves on from
 * there without a jump.
 */
export function glyphMotion(pair: string, eye: 0 | 1, seconds: number): GlyphMotion {
  // Before its state has begun (and on a still bot): where the loop sets off from.
  seconds = Math.max(0, seconds)
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
      /*
       * Wide awake: the dots hold their place while the FACE looks up and about
       * (thinkingGlance turns the head, and the screen turns with it), then the
       * two dots bounce in turn, a thought loading. Colin, 2026-10-05, of the
       * dots looking around: "my initial instinct is the dots shouldnt move the
       * screen should just rotate with the body". Frame by frame they never held
       * still: they darted across the glass on this loop's own glances while the
       * rig's look slid them on a schedule of its own, two at once
       * (docs/FINDING-eye-motion-bloub.md).
       */
      const t = frac(seconds / THINKING_CYCLE_S) * THINKING_CYCLE_S
      if (t < LOOK_ABOUT_S) return { ...AT_REST, dy: DOTS_REST_Y }
      // The loader: each dot rises and falls, the right half a beat after the left...
      const beat = Math.max(0, Math.sin((t - LOOK_ABOUT_S) * Math.PI * 2.4 - eye * Math.PI * 0.6))
      // ...coming in softly and dying away over the loop's last stretch, so each loop starts and ends at rest
      // (0.613: at every wrap each dot used to cross up to 1.9 in one frame).
      const p = Math.min(1, (t - LOOK_ABOUT_S) / 0.25)
      const q = Math.max(0, Math.min(1, (t - (THINKING_CYCLE_S - 0.35)) / 0.35))
      const swing = beat * p * p * (3 - 2 * p) * (1 - q * q * (3 - 2 * q))
      return { dx: 0, dy: DOTS_REST_Y - 1.3 * swing, sx: 1 - 0.12 * swing, sy: 1 + 0.12 * swing, shown: true }
    }
    case '^^': {
      // The right eye a beat behind the left, so both set off from rest.
      const bob = Math.max(0, Math.sin(seconds * 4.2 - eye * 0.35))
      return { dx: 0, dy: -1.5 * bob, sx: 1 + 0.06 * bob, sy: 1 - 0.08 * bob, shown: true }
    }
    case 'xx':
    case '><': {
      // Stuck: a shudder now and then -- and `> <` (2026-10-05) winces with it, pinching in, as at a strain.
      const shudder = hump(frac(seconds / 3), 0, 0.14)
      const wince = pair === '><' ? hump(frac(seconds / 3), 0, 0.4) : 0
      return { ...AT_REST, dx: 1.1 * shudder * Math.sin(seconds * 70), sx: 1 - 0.18 * wince, sy: 1 + 0.06 * wince }
    }
    case 'cc': {
      // Asleep: the slow rise and fall of breathing, nothing more.
      const breath = Math.sin(seconds * 1.3)
      return { ...AT_REST, dy: 0.5 * breath, sx: 1 + 0.03 * breath }
    }
    default:
      return AT_REST
  }
}

/**
 * A THINKING FACE LOOKS ABOUT WITH ITS HEAD (2026-10-05).
 *
 * The thinking dots' loop is 4.2 s: for its first half the face looks up and
 * about -- up and to the left, then up and to the right -- and for its second
 * the dots bounce in turn while the head goes back to the rig's own heading.
 * The dots hold their place on the screen throughout (glyphMotion); what turns
 * is the head, and the screen with it, so a face looks somewhere as one piece.
 *
 * The motion is bloub's (github.com/jeremy-prt/bloub, its engine's gaze), as
 * the finding read it: every move is an ease-out toward its target -- quick to
 * leave, slow to land, never past it -- and a pure function of time, so a still
 * bot (second 0) is at rest and the same moment always draws the same face.
 * The look REPLACES the rig's heading as `mix` rises, rather than adding to it:
 * added, two turns on two clocks would be a head that never settles on either.
 *
 * One change from bloub: a head is heavier than an eye. Started at full speed,
 * as bloub starts its eyes, a turn moved a 96px face 2.3 pixels in its first
 * frame from standing still -- a flick, where the rig's own turns never moved
 * it more than half a pixel a frame (the finding's frames). So each move's
 * first frames are softened (glanceEase), and there are two glances, each
 * held, where the dots had three darts in the same two seconds.
 */
export interface HeadGlance {
  /** The turn the face looks to, radians: + is to its left, your right. */
  readonly yaw: number
  /** Its tilt, radians: + is up. */
  readonly pitch: number
  /** How much of the head the look has: 0 leaves the rig's own heading, 1 replaces it. */
  readonly mix: number
  /**
   * How much of the rig's own turning is kept while the face thinks: 1 all of
   * it. bloub's `wander`: while a look leads, the idle drift fades, or the
   * head seems to search without ever holding. Kept whole, the rig's heading
   * wandered as far as 0.6 behind the look, and handing the head back swung it
   * across in half a second, the fastest it ever moved (the finding's frames).
   */
  readonly wander?: number
}

/** How much of the rig's own turning a thinking face holds back (HeadGlance.wander). */
export const THINKING_HUSH = 0.7

export const THINKING_CYCLE_S = 4.2
/** The first half of the loop: the face looks about while the dots hold. */
export const LOOK_ABOUT_S = 2.1
/** Where the thinking dots rest on the screen, a little up: the bounce's own floor. */
const DOTS_REST_Y = -0.5
/** How long a glance takes to land (bloub's gaze lands in 0.24 s; a head is heavier than an eye). */
export const HEAD_GLANCE_S = 0.6
/** Up and to the left, then up and to the right, each held: the old loop's glances, made turns of the head. */
const THINKING_GLANCES: readonly { readonly yaw: number; readonly pitch: number }[] = [
  { yaw: -0.22, pitch: 0.12 },
  { yaw: 0.22, pitch: 0.1 }
]

/** Quick to leave, slow to land, never past it: bloub's curve for every move of its body and eyes. */
export function easeOutQuint(t: number): number {
  return 1 - (1 - Math.max(0, Math.min(1, t))) ** 5
}

/**
 * bloub's ease-out with its first frames softened, for a head: it starts from
 * rest, is at its quickest a fifth of the way in (about twice its average
 * speed, where easeOutQuint starts at five times it), and lands as slowly.
 * Read at 30 frames a second over HEAD_GLANCE_S, its first frame goes 5% of
 * the way, where easeOutQuint's over 0.45 s went 32%. Still never past it.
 */
export function glanceEase(t: number): number {
  return easeOutQuint(Math.max(0, Math.min(1, t)) ** 1.6)
}

/**
 * Where a thinking face looks, `seconds` into its thinking (FaceChange.since:
 * the look starts as the dots open, on the state's own clock); before then,
 * and on a still bot, it looks where the rig has it.
 */
export function thinkingGlance(seconds: number): HeadGlance {
  if (seconds <= 0) return { yaw: 0, pitch: 0, mix: 0 }
  const t = frac(seconds / THINKING_CYCLE_S) * THINKING_CYCLE_S
  const every = LOOK_ABOUT_S / THINKING_GLANCES.length
  const at = Math.min(THINKING_GLANCES.length - 1, Math.floor(t / every))
  const to = THINKING_GLANCES[at] ?? { yaw: 0, pitch: 0 }
  const from = THINKING_GLANCES[Math.max(0, at - 1)] ?? to
  // Each glance eases from the last one's place, which it reached before this began; the first is reached by the mix.
  const k = at === 0 ? 1 : glanceEase((t - at * every) / HEAD_GLANCE_S)
  // The look takes the head as the loop begins and gives it back as the dots start to bounce.
  const mix = t < LOOK_ABOUT_S ? glanceEase(t / HEAD_GLANCE_S) : 1 - glanceEase((t - LOOK_ABOUT_S) / HEAD_GLANCE_S)
  return { yaw: from.yaw + (to.yaw - from.yaw) * k, pitch: from.pitch + (to.pitch - from.pitch) * k, mix }
}

/**
 * A number that eases to each new target from wherever it is when the target
 * changes: bloub's rule for its gaze (`setLook` starts again from the CURRENT
 * value, never from the last target, so a change midway glides on instead of
 * stepping back first). Between changes it is a pure function of time.
 */
export function easedValue(
  initial: number,
  seconds: number
): { readonly set: (target: number, now: number) => void; readonly at: (now: number) => number; readonly settled: (now: number) => boolean } {
  let from = initial
  let to = initial
  let since = Number.NEGATIVE_INFINITY
  const at = (now: number): number => from + (to - from) * glanceEase((now - since) / seconds)
  return {
    set: (target, now) => {
      if (target === to) return
      from = at(now)
      to = target
      since = now
    },
    at,
    /** Arrived: at its target, and staying there until it is given another. */
    settled: (now) => now - since >= seconds
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
 * mascot's navy and cyan. The visor is set flat in the body's front (frontPlane,
 * 0.574), so it turns with the body; and the rig skips the face when the head
 * is turned away, so the back of the head is plain, as the mascot's is.
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
/** The eye's turn past which the rig's left eye is out of sight (asin(12.5 / 30) + 90deg, on its face sphere). */
const LEFT_EYE_HIDDEN_AT = -1.12
/**
 * A SCREEN IS SET FLAT IN THE BODY'S FRONT (0.574). Colin, 2026-10-03: "it
 * just still kind of looks janky and needs work with the physics". Frame by
 * frame (_tools/look-screen-motion.mjs) the screen slid across the body as the
 * head turned, and its far eye was cut at the body's edge. The cause: the rig
 * lays its own eyes on an imagined sphere, but its body is a flat-fronted
 * extrusion, and a screen laid on that sphere (at a little over half the turn,
 * 0.55, to keep both eyes) moved one way while the body's front moved
 * another. A screen is a flat panel: it is now drawn in the plane of the
 * body's front layer -- the very transform the rig clips the face to -- so it
 * turns, tilts and foreshortens exactly as the plastic around it does, and,
 * fitted inside the outline (fitVisor), it never reaches the body's edge.
 * FRONT_DEPTH and FRONT_RIM are the library's own: its half-depth (15 x its
 * default depth 0.65) and its front layer's scale (its rim, 0.9 at half).
 */
const FRONT_DEPTH = 15 * 0.65
const FRONT_RIM = 1 - (1 - 0.9) * 0.5
/** Where a face sits on its outline, in the outline's 0 to 100 units, and its scale. */
export interface FaceAt {
  readonly x: number
  readonly y: number
  readonly scale: number
}
/**
 * The body's front layer, as a transform of the face's own units: drawn after
 * the face's transform, a flat drawing lands in the plane of the body's front.
 * The library's, layer for layer (its cos is held at 0.22 or more, as it holds them).
 */
export function frontPlane(yaw: number, pitch: number, at: FaceAt): readonly [number, number, number, number, number, number] {
  const held = (value: number): number => (Math.abs(value) < 0.22 ? (value < 0 ? -0.22 : 0.22) : value)
  const cy = held(Math.cos(yaw))
  const sy = Math.sin(yaw)
  const cp = held(Math.cos(pitch))
  const sp = Math.sin(pitch)
  const fx = at.x - 50
  const fy = at.y - 50
  return [
    cy * FRONT_RIM,
    sy * sp * FRONT_RIM,
    0,
    cp * FRONT_RIM,
    (cy * FRONT_RIM * fx + sy * FRONT_DEPTH - fx) / at.scale,
    (sy * sp * FRONT_RIM * fx + cp * FRONT_RIM * fy - cy * sp * FRONT_DEPTH - fy) / at.scale
  ]
}
/** How much larger a lit glyph is than an inked one: a screen's eyes fill it, as the mascot's do. */
const SCREEN_GLYPH_SCALE = 1.3
/** An inked glyph a little larger than the eye, and heavier: a dot is round and full, and a stroke of the dot's size reads thinner. */
const INKED_GLYPH_SCALE = 1.12

/**
 * EVERY EYE STAYS INSIDE ITS SCREEN (0.562). Colin, 2026-10-03: "some of them
 * the eyes are clipping through the top of the square or almost". The eyes'
 * PLACE was kept on the screen, but not their SIZE or their motion: a
 * thinking eye looks up by 1.8 units and a done eye bobs, and on a small
 * fitted screen the glyph's top ran into the screen's edge and was cut. So a
 * glyph's whole reach is measured -- its strokes, half its weight, and the most
 * its motion can move (2 units) and stretch it (1.16x, glyphMotion) -- and the
 * glyphs are made only as large, and placed only as far, as the screen can
 * hold with SCREEN_PAD to spare. Checked for every pair, glance and moment.
 */
const MOTION_REACH = 2
const MOTION_STRETCH = 1.16
export const SCREEN_PAD = 1.5

/** How far a glyph's ink can reach from its eye's centre, in glyph units, across and down, moving as it does. */
export function glyphReach(shape: GlyphShape): { readonly x: number; readonly y: number } {
  let x = 0
  let y = 0
  for (const line of shape.lines) {
    for (let i = 0; i < line.length; i += 2) {
      x = Math.max(x, Math.abs(line[i] ?? 0))
      y = Math.max(y, Math.abs(line[i + 1] ?? 0))
    }
  }
  if (shape.ring !== undefined) {
    x = Math.max(x, shape.ring)
    y = Math.max(y, shape.ring)
  }
  const half = shape.weight / 2
  return { x: x * MOTION_STRETCH + MOTION_REACH + half, y: y * MOTION_STRETCH + MOTION_REACH + half }
}

export interface ScreenEyeLayout {
  /** The glyphs' size, glyph units to face units. */
  readonly scale: number
  /** Each eye's centre in face units, left then right. */
  readonly centres: readonly [readonly [number, number], readonly [number, number]]
}

/**
 * Where a screen's two eyes go and how large they are: as large as the
 * mascot's on a screen Prompt's size, smaller on a smaller screen, and never
 * so large or so far out that a glyph, moving, could touch the screen's edge
 * or the other eye. A glance moves them only within the room that leaves.
 */
export function screenEyeLayout(
  box: VisorBox,
  pair: EyeGlyphs,
  look: { readonly x: number; readonly y: number },
  eyeY: number
): ScreenEyeLayout {
  const dot = GLYPH_SHAPES['\u2022'] as GlyphShape
  const reaches = [glyphReach(GLYPH_SHAPES[pair[0]] ?? dot), glyphReach(GLYPH_SHAPES[pair[1]] ?? dot)]
  const reachX = Math.max(reaches[0]?.x ?? 0, reaches[1]?.x ?? 0)
  const reachY = Math.max(reaches[0]?.y ?? 0, reaches[1]?.y ?? 0)
  const k = Math.max(0.5, Math.min(1, box.halfWidth / EYES_VISOR.halfWidth, box.halfHeight / EYES_VISOR.halfHeight))
  const roomX = box.halfWidth - SCREEN_PAD
  const roomY = box.halfHeight - SCREEN_PAD
  // Two eyes side by side, a unit apart at the least, inside the screen across; one eye's height inside it down.
  const scale = Math.max(0.1, Math.min(SCREEN_GLYPH_SCALE * k, roomY / reachY, (roomX - 0.5) / (2 * reachX)))
  // Half a unit of air between the eyes at the least: the scale above leaves room for it.
  const spread = Math.max(reachX * scale + 0.5, Math.min(12.5 * k, roomX - reachX * scale))
  const across = Math.max(0, roomX - spread - reachX * scale)
  const down = Math.max(0, roomY - reachY * scale)
  const x = Math.max(-across, Math.min(across, look.x * 0.9))
  const y = Math.max(box.y - down, Math.min(box.y + down, eyeY + look.y * 0.5))
  return { scale, centres: [[x - spread, y], [x + spread, y]] }
}

/** A rounded rectangle's outline in face units, evenly spaced. */
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

/** What the rig's pose says about the head this frame: its turn, and where its eyes look (face units). */
export interface FacePose {
  readonly yaw: number
  readonly pitch: number
  readonly lookX: number
  readonly lookY: number
  /** The body's rise this frame, in the outline's units, up negative: the rig's own `y`. */
  readonly y?: number
}

/**
 * A SCREEN'S EYES HAVE WEIGHT (0.574). Colin, 2026-10-03: "you seem more than
 * capable of showing emotion with motion and the eyes, it just still kind of
 * looks janky and needs work with the physics". Set into the screen, the eyes
 * moved as one piece with the body, a sticker on it: a hop lifted and dropped
 * them without a trace. Now they trail it, as a thing with weight does: when
 * the body speeds up or slows down (a hop's take-off and landing, a turn) the
 * eyes are left behind by a unit or two and spring back, with one soft
 * overshoot. The spring is under critical damping (2 x sqrt(LAG_SPRING) is
 * 32), so it settles inside half a second; the lag is held to LAG_MOST, and
 * the eyes' own room on the screen (screenEyeLayout) still bounds them.
 *
 * ONLY A HOP (2026-10-05). A turn no longer throws them: lit on the glass,
 * the eyes turn with it as one piece (Colin: "the dots shouldnt move the
 * screen should just rotate with the body"), and a thinking face now turns to
 * look about (thinkingGlance), which would have flung them across at every
 * glance. A hop's take-off and landing still leave them behind.
 */
export interface Lag {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
}
export const LAG_REST: Lag = { x: 0, y: 0, vx: 0, vy: 0 }
const LAG_SPRING = 260
const LAG_DAMPING = 22
const LAG_GAIN = 0.35
const LAG_MOST = 3

/** One step of the eyes' spring: `kickX`, `kickY` are the change in the body's speed this step (face units a second). */
export function stepLag(lag: Lag, dt: number, kickX: number, kickY: number): Lag {
  const vx = lag.vx + (-LAG_SPRING * lag.x - LAG_DAMPING * lag.vx) * dt - kickX * LAG_GAIN
  const vy = lag.vy + (-LAG_SPRING * lag.y - LAG_DAMPING * lag.vy) * dt - kickY * LAG_GAIN
  const held = (value: number): number => Math.max(-LAG_MOST, Math.min(LAG_MOST, value))
  return { x: held(lag.x + vx * dt), y: held(lag.y + vy * dt), vx, vy }
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

/**
 * WHAT A SCREEN GLOWS (0.562). Colin, 2026-10-03: "why do white ones have the
 * cool blue terminal font color and the others just stick with the color of
 * the teammate, i think we can come up with something better than that". The
 * lit eyes took a bright tint of the body's own hue, so a pale teammate came
 * out terminal blue and every other one wore its own colour twice -- a rule
 * nobody chose. Now every screen glows ONE terminal colour, the cool cyan he
 * liked, and colour means something: green when the teammate is done, amber
 * while it waits on you (the same amber as its ring), red when it is stuck --
 * a terminal's own green, yellow and red. The teammate's hue stays where it
 * says who: the body, and the tint of the screen's glass.
 */
export type Phosphor = 'cyan' | 'green' | 'amber' | 'red'

export const PHOSPHOR: Readonly<Record<Phosphor, { readonly lit: string; readonly glow: string }>> = {
  cyan: { lit: 'hsl(190, 100%, 80%)', glow: 'hsla(192, 100%, 58%, 0.85)' },
  green: { lit: 'hsl(140, 90%, 74%)', glow: 'hsla(140, 95%, 48%, 0.85)' },
  amber: { lit: 'hsl(40, 100%, 72%)', glow: 'hsla(36, 100%, 52%, 0.85)' },
  red: { lit: 'hsl(356, 100%, 77%)', glow: 'hsla(356, 100%, 58%, 0.85)' }
}

/**
 * A FLASH, NOT A COLOUR (2026-10-05). Colin, of a finished teammate's green
 * eyes: "dont make the eye color lime please just white, if you want work
 * that into a color change flash or something you can but not the entire
 * static color". The eyes show the flash's colour through the blink that
 * brings in the new glyphs, then ease back to their own light.
 */
export const FLASH_S = 1.2
const FLASH_HOLD_S = 0.3

/** How far a flash has faded back to the eyes' own colour, `seconds` after it began: 0 all flash, 1 gone. */
export function flashFade(seconds: number): number {
  const k = Math.max(0, Math.min(1, (seconds - FLASH_HOLD_S) / (FLASH_S - FLASH_HOLD_S)))
  return k * k * (3 - 2 * k)
}

/** A PHOSPHOR colour as red, green and blue (0 to 255) and alpha: `hsl(h, s%, l%)` or `hsla(h, s%, l%, a)`. */
export function phosphorRgba(color: string): readonly [number, number, number, number] {
  const m = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)/.exec(color)
  if (m === null) return [255, 255, 255, 1]
  const h = Number(m[1]) / 360
  const s = Number(m[2]) / 100
  const l = Number(m[3]) / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p
    return Math.round(v * 255)
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3), m[4] === undefined ? 1 : Number(m[4])]
}

/** Two PHOSPHOR colours mixed, `k` of the way from the first to the second, as an `rgba()` a canvas takes. */
export function mixPhosphor(from: string, to: string, k: number): string {
  const a = phosphorRgba(from)
  const b = phosphorRgba(to)
  const mix = (i: number): number => a[i]! + (b[i]! - a[i]!) * k
  return `rgba(${Math.round(mix(0))}, ${Math.round(mix(1))}, ${Math.round(mix(2))}, ${Number(mix(3).toFixed(3))})`
}

export interface EyePaint {
  readonly ink: string
  /** What a screen's eyes glow this frame; cyan when not given. Ignored when the face is no screen. */
  readonly phosphorNow?: () => Phosphor
  /** The colour a screen's eyes flash, while one is asked for (FLASH_S); undefined, none. */
  readonly flashNow?: () => Phosphor | undefined
  /** The body colour, for a screen's own tints; undefined, the face is no screen. */
  readonly screenOf: string | undefined
  /** Device pixels a face unit spans, for the glow. */
  readonly pixelsPerUnit: number
  /** The screen's size on this face; Prompt's when not given. */
  readonly visor?: VisorBox
  /** Where the eyes sit on the face, in face units, y down: the rig's 1, or -3.5 above a mouth. */
  readonly eyeY?: number
  /** Where the face sits on the body, for the plane of its front; a centred face of scale 1 when not given. */
  readonly faceAt?: FaceAt
  /** The second, on this bot's clock, its screen switches on (POWER_ON_S); undefined, it is simply on. */
  readonly bootAt?: () => number | undefined
  /** How long that switching on takes: POWER_ON_S, or a change's flick (CRT_FLICK_S). */
  readonly bootSpan?: () => number
  /**
   * What the face is doing (BotProps.blinkKey): a new one is a change the face
   * performs (FaceChange), even when its eyes and their colour stay the same.
   */
  readonly keyNow?: () => string | undefined
  /**
   * How far the face has settled to rest (BodyFrame.rest): 0 moving, 1 at
   * rest. A resting face's loops are drawn at their rest, second 0 of their
   * state, where a still bot's are.
   */
  readonly restNow?: () => number
}

/*
 * EYES BLINK WHEN THEY CHANGE (0.562). A teammate that starts work, finishes
 * or gets stuck used to swap one glyph for the next between two frames -- a
 * pop. Now the old eyes close, the new ones open in their place, and a new
 * glow comes in with them: SWAP_S, as long as a blink. A still bot (seconds
 * 0) swaps at once.
 */
export const SWAP_S = 0.26

/**
 * ONE CHANGE, ONE CHOREOGRAPHY (2026-10-05). Frame by frame
 * (look-eyes-moving.mjs --sequence), a change of state was several things at
 * once: a screen blinked twice, its own swap and then the rig's blink a few
 * frames later; a finished teammate's old eyes turned green as they closed,
 * and its hop had left the ground before the new eyes were open; and each
 * new loop began wherever the bot's clock happened to be, a cursor mid-blink,
 * a head mid-turn. bloub hides each change of shape behind one blink. So a
 * change is performed in order, one beat after another:
 *
 * 1. the eyes shut: one blink, a screen's own swap (SWAP_S), or on a face of
 *    plastic the rig's own blink, never both;
 * 2. under the shut lids, the new eyes come in, in their colour, with their
 *    flash;
 * 3. they open, and the state's loops start, from rest (glyphMotion and
 *    thinkingGlance on the state's own clock: `since`);
 * 4. then the body answers: its mood, its hop, the head's thinking look
 *    (Bot's RiggedBot, once `open`).
 *
 * A change asked for in the middle of another goes on from where the lids
 * are: the eyes never spring open to shut again.
 */
export interface FaceChange {
  /**
   * When the state shown began, on the bot's clock, as its eyes opened on it:
   * its loops run from here. 0 for the state a face first appears in, whose
   * loops run on the bot's own clock, a row of them out of step.
   */
  readonly since: number
  /** No change under way: the eyes are open on the state shown, and the body may answer it. */
  readonly open: boolean
  /** How far a change has the eyes shut this frame: 0 open, 1 shut. */
  readonly shut: number
  /** Open, and nothing else on the face moving on its own: no flash fading, no screen switching on. A face may rest. */
  readonly quiet: boolean
  /** How many changes the face has begun: a face of plastic blinks once at each. */
  readonly count: number
  /** The eyes shown, whatever is asked for next. */
  readonly eyes: EyeGlyphs | undefined
}

/**
 * A SCREEN SWITCHES ON (2026-10-05). bloub enters a view with a turn of its
 * gaze and rings (`swirl`); a screen face's own entrance is a CRT's: a line
 * of light across the middle of the glass widens to its edges, opens into a
 * flash that settles to the dark, and the eyes blink open. Once a session for
 * each teammate, as it first appears (Bot's `bootKey`); a still bot is simply on.
 */
export const POWER_ON_S = 0.9

/**
 * THE SCREEN SWITCHES ON AGAIN FOR A CHANGE THAT MATTERS (2026-10-05). Colin:
 * *"the crt tv blinks are a good addition and should be weaved in/included
 * whenever"*. Not for every change -- a teammate at work changes its eyes every
 * few seconds, and a power-on that often reads as a fault -- but for the ones
 * worth looking up for, the screen goes off and comes on again on the new
 * face: starting work, finishing, getting stuck, waiting on you (`'on'`, all
 * of POWER_ON_S). And now and then at work, a flick: the same, a beat's worth
 * (`'flick'`, CRT_FLICK_S). Everything else blinks, as before.
 */
export type CrtChange = 'on' | 'flick'
/** A flick: the screen's power-on, quick. */
export const CRT_FLICK_S = 0.4
/** How a face's change comes in, from the face it leaves to the one it brings, the `count`th change: a CRT, or a blink (undefined). */
export type CrtRule = (from: string | undefined, to: string | undefined, count: number) => CrtChange | undefined
/** Where in the power-on the line has crossed the glass, the flash has settled, and the eyes start to open. */
const POWER_LINE = 0.33
const POWER_FLASH = 0.67

/** The power-on's light at `phase` (0 to 1): the line's half width and half height as fractions of the glass, and its strength. */
export function powerOnLight(phase: number): { readonly width: number; readonly height: number; readonly alpha: number } {
  const p = Math.max(0, Math.min(1, phase))
  const across = easeOutQuint(p / POWER_LINE)
  const open = easeOutQuint((p - POWER_LINE) / (POWER_FLASH - POWER_LINE))
  return { width: across, height: open, alpha: p < POWER_LINE ? 1 : 0.85 * (1 - open) }
}

/** How open a screen's eyes are at `phase` of its power-on: shut until the flash has settled, then blinking open. */
export function powerOnEyes(phase: number): number {
  return easeOutQuint((Math.max(0, Math.min(1, phase)) - POWER_FLASH) / (1 - POWER_FLASH))
}

/** What a face shows: its eyes, their colour, and what it is doing (FaceChange). */
export interface ShownFace {
  readonly pair: EyeGlyphs | undefined
  readonly tone: Phosphor
  readonly key: string | undefined
}

/** A face's changes as it performs them (FaceChange): a bot's screen's, and a pet's (PetSprite). */
export interface FaceChanges {
  /** Where the face's change is at second `s`, worked out once a frame. */
  readonly at: (s: number) => FaceChange
  /** What the face shows now. */
  readonly shown: () => ShownFace
  /** What a change under way brings in; undefined, none is under way. */
  readonly coming: () => ShownFace | undefined
  /** The flash shown and the second it came in (FLASH_S); undefined, none has. */
  readonly flash: () => { readonly colour: Phosphor; readonly at: number } | undefined
}

/**
 * A face's changes (FaceChange), read from what it is asked to show each
 * frame: `wantedNow` its eyes, colour and what it is doing, `flashNow` the
 * flash asked for, `bootAt` the second its screen switches on. One for every
 * face that performs them, so a pet with a screen changes as a bot does.
 */
export function faceChanges(
  wantedNow: () => ShownFace,
  flashNow: () => Phosphor | undefined,
  bootAt: () => number | undefined = () => undefined,
  bootSpan: () => number = () => POWER_ON_S
): FaceChanges {
  // A face shows what it first appears in at once.
  let shown: ShownFace = wantedNow()
  // The flash shown (flashNow), and when it came in on this face's clock (FLASH_S): on the first frame that moves, or with a change's new eyes.
  let flashShown: Phosphor | undefined
  let flashAt = Number.NEGATIVE_INFINITY
  // The change under way (FaceChange): when its eyes began to shut, what it brings in, and whether that is in yet.
  let swap: { readonly start: number; readonly to: ShownFace; readonly in: boolean } | undefined
  /** 0 open, 1 shut: how far the change-blink has the eyes closed this frame. */
  let swapShut = 0
  // When the state shown began (FaceChange.since), how many changes there have been, and the second last read.
  let since = 0
  let changes = 0
  let changedAt = Number.NaN
  let changeNow: FaceChange = { since: 0, open: true, shut: 0, quiet: true, count: 0, eyes: shown.pair }
  const sameEyes = (a: EyeGlyphs | undefined, b: EyeGlyphs | undefined): boolean => (a?.join('') ?? '') === (b?.join('') ?? '')
  const sameShown = (a: ShownFace, b: ShownFace): boolean => sameEyes(a.pair, b.pair) && a.tone === b.tone && a.key === b.key
  const at = (s: number): FaceChange => {
    // A still bot, at second 0 every frame, keeps nothing from one frame to the next.
    if (s === changedAt && s !== 0) return changeNow
    changedAt = s
    const wanted = wantedNow()
    const flash = flashNow()
    if (s === 0) {
      // Still: nothing to perform, and nothing flashes.
      swap = undefined
      swapShut = 0
      shown = wanted
      flashShown = undefined
      since = 0
    } else {
      if (!sameShown(swap?.to ?? shown, wanted)) {
        // A change. Asked for while one is under way, the lids go on from where they are: still shutting, they shut
        // on the newest; opening, they shut again from as far open as they have come.
        const p = swap === undefined ? 1 : (s - swap.start) / SWAP_S
        swap = { start: swap === undefined || p >= 1 ? s : p < 0.5 ? swap.start : s - (1 - p) * SWAP_S, to: wanted, in: false }
        changes += 1
      }
      if (swap !== undefined) {
        const p = (s - swap.start) / SWAP_S
        if (p >= 0.5 && !swap.in) {
          // Under the shut lids: the new eyes, in their colour, and the state begins as they open...
          swap = { ...swap, in: true }
          shown = swap.to
          since = swap.start + SWAP_S
          // ...with the flash they come in with, from the moment they come in.
          if (flash !== flashShown) {
            flashShown = flash
            flashAt = swap.start + SWAP_S / 2
          }
        }
        swapShut = p >= 1 ? 0 : p < 0.5 ? p * 2 : (1 - p) * 2
        if (p >= 1) swap = undefined
      }
      // A flash with no change to bring it in comes in at once.
      if (flash !== flashShown && (swap === undefined || swap.in)) {
        flashShown = flash
        flashAt = s
      }
    }
    const boot = bootAt()
    const quiet = swap === undefined && (s === 0 || ((flashShown === undefined || flashFade(s - flashAt) >= 1) && (boot === undefined || s - boot >= bootSpan())))
    changeNow = { since, open: swap === undefined, shut: swapShut, quiet, count: changes, eyes: shown.pair }
    return changeNow
  }
  return {
    at,
    shown: () => shown,
    coming: () => swap?.to,
    flash: () => (flashShown === undefined ? undefined : { colour: flashShown, at: flashAt })
  }
}

/** A screen's light at second `s`: its own colour, or a flash easing back to it (FLASH_S). */
export function screenLight(
  tone: Phosphor,
  flash: { readonly colour: Phosphor; readonly at: number } | undefined,
  s: number
): { readonly lit: string; readonly glow: string } {
  const own = PHOSPHOR[tone]
  if (flash === undefined) return own
  const k = flashFade(s - flash.at)
  if (k >= 1) return own
  return { lit: mixPhosphor(PHOSPHOR[flash.colour].lit, own.lit, k), glow: mixPhosphor(PHOSPHOR[flash.colour].glow, own.glow, k) }
}

/**
 * A glyph's strokes as a path at the context's transform (the eye's centre),
 * moved and squashed by `motion` and a blink, `scale` context units to a
 * glyph unit. A dot cannot be squashed (it has no length): it blinks into a
 * dash instead (blinkingDot). Returns the weight to stroke it at, in glyph units.
 */
export function traceGlyph(context: CanvasRenderingContext2D, glyph: GlyphShape, motion: GlyphMotion, scale: number, blinkSquash: number): number {
  const closing = glyph === DOT_GLYPH ? Math.max(0, Math.min(1, (1 - blinkSquash) / 0.92)) : 0
  const shape = closing > 0 ? blinkingDot(closing) : glyph
  const squash = closing > 0 ? 1 : blinkSquash
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
  return shape.weight
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
): {
  readonly frame: (pose: FacePose, seconds: number) => void
  readonly drawsGlyphs: () => boolean
  readonly shownKey: () => string | undefined
  /** Where the face's change is at this second (FaceChange): read before the pose is worked out; `frame` reads it too. */
  readonly change: (seconds: number) => FaceChange
} {
  // From the prototype, never the context: a second effect on the same canvas must not stack on the first.
  const own = Object.getPrototypeOf(context) as CanvasRenderingContext2D
  const stroke = own.stroke.bind(context) as (...args: unknown[]) => void
  const fill = own.fill.bind(context) as (...args: unknown[]) => void
  const translate = own.translate.bind(context)
  const screen = paint.screenOf
  const box = paint.visor ?? EYES_VISOR
  const visorShape = visorOutline(box)
  // A screen's glow is read each frame (PHOSPHOR), so a state's colour arrives without restarting the rig.
  let lit = screen === undefined ? paint.ink : PHOSPHOR.cyan.lit
  let glow = screen === undefined ? undefined : PHOSPHOR.cyan.glow
  const visorTop = screen === undefined ? '' : sameHue(screen, 0.42, 0.17)
  const visorBottom = screen === undefined ? '' : sameHue(screen, 0.5, 0.08)
  let drawn = 0
  const faceAt = paint.faceAt ?? { x: 50, y: 50, scale: 1 }
  // The body's front this frame (frontPlane): the screen and its eyes are drawn flat in it.
  let plane = frontPlane(0, 0, faceAt)
  let look = { x: 0, y: 0 }
  // The eyes' lag behind the body (stepLag), and the body's last place and speed it is measured from.
  let lag = LAG_REST
  let body: { readonly at: number; readonly y: number; readonly vy: number } | undefined
  let seconds = 0
  // The face's changes (faceChanges), and from the last read of them: how shut its change-blink has the eyes, and when the state shown began.
  const changes = faceChanges(
    () => ({ pair: eyesNow(), tone: paint.phosphorNow?.() ?? 'cyan', key: paint.keyNow?.() }),
    () => paint.flashNow?.(),
    () => paint.bootAt?.(),
    () => paint.bootSpan?.() ?? POWER_ON_S
  )
  let swapShut = 0
  let since = 0
  /*
   * A SCREEN'S EYES OPEN WHEN THE BOT WAKES. The rig closes its eyes to sleep
   * and opens them again slowly, over seconds, and a screen's glyphs followed
   * its openness -- so the title screen's locust, woken, kept squinting bars
   * for a second and more. A screen shows sleep with its own closed glyph
   * ('c'), so on a screen only a blink closes the eyes: an eye shut for longer
   * than a blink is drawn open.
   */
  const BLINK_S = 0.35
  let shutSince: number | undefined
  const screenOpenness = (open: number): number => {
    if (open >= 0.5 || seconds === 0) {
      shutSince = undefined
      return open
    }
    shutSince ??= seconds
    return seconds - shutSince > BLINK_S ? 1 : open
  }
  let leftHidden = false
  let face: DOMMatrix | undefined
  /*
   * THE FRONT, AS THE RIG DREW IT (0.577). The rig clips the face to its body
   * with the body's front layer as the transform, the moment before it moves
   * to the face. That transform is read there, and the screen is drawn in it:
   * the plane is the rig's own, whatever its version computes it from (0.2's
   * cushion shifts the front by the body's thickness at the face, which 0.1's
   * flat slab did not). `frontPlane` stands in only where no clip was seen.
   */
  let front: DOMMatrix | undefined
  if (screen !== undefined) {
    const clip = own.clip.bind(context) as (...args: unknown[]) => void
    ;(context as unknown as { translate: (x: number, y: number) => void }).translate = (x, y) => {
      face = context.getTransform()
      translate(x, y)
    }
    ;(context as unknown as { clip: (...args: unknown[]) => void }).clip = (...args) => {
      // The rig clips to a path it names; the screen's own clips name none.
      if (args.length > 0) front = context.getTransform()
      clip(...args)
    }
  }
  /** Into the plane of the body's front, in the face's own units, where the screen is drawn flat. */
  const onFront = (): void => {
    if (face === undefined) return
    if (front !== undefined) {
      context.setTransform(front)
      // The context's own translate: the shadowed one would take this for the face's.
      translate(faceAt.x, faceAt.y)
      context.scale(faceAt.scale, faceAt.scale)
      return
    }
    context.setTransform(face)
    context.transform(...plane)
  }
  const trace = (): void => {
    context.beginPath()
    visorShape.forEach(([px, py], i) => {
      if (i === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    })
    context.closePath()
  }
  const visor = (booting: number | undefined): void => {
    if (face === undefined) return
    context.save()
    onFront()
    context.globalAlpha = 1
    trace()
    const top = box.y - box.halfHeight
    const ground = context.createLinearGradient(0, top, 0, box.y + box.halfHeight)
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
    context.fillRect(-box.halfWidth, top, box.halfWidth * 2, box.halfHeight)
    context.strokeStyle = 'rgba(255,255,255,0.16)'
    context.lineWidth = 1.6
    stroke()
    if (booting !== undefined) {
      // Switching on (POWER_ON_S): the line of light, then its flash, inside the glass.
      const light = powerOnLight(booting)
      const halfWidth = box.halfWidth * light.width
      const halfHeight = 0.9 + (box.halfHeight - 0.9) * light.height
      if (light.alpha > 0.001 && halfWidth > 0.001) {
        context.globalAlpha = light.alpha
        context.fillStyle = lit
        if (glow !== undefined) {
          context.shadowColor = glow
          context.shadowBlur = 5 * paint.pixelsPerUnit
        }
        context.fillRect(-halfWidth, box.y - halfHeight, halfWidth * 2, halfHeight * 2)
      }
    }
    context.restore()
  }
  /** Where this screen is in its power-on (0 to 1, dark while it waits its turn), or undefined once it is on. */
  const booting = (): number | undefined => {
    const at = paint.bootAt?.()
    if (at === undefined || seconds === 0) return undefined
    const phase = (seconds - at) / (paint.bootSpan?.() ?? POWER_ON_S)
    return phase < 1 ? Math.max(0, phase) : undefined
  }
  /**
   * One glyph at the current transform (the eye's centre), its strokes moved and squashed, its weight kept.
   *
   * ITS WEIGHT THE SAME HOWEVER THE HEAD TURNS (2026-10-05). Given `steady`
   * (device pixels a glyph unit is at rest), a screen's glyph is traced in the
   * screen's plane, so its places turn and tilt with it, and stroked flat at
   * that weight: drawn in the plane, a turned head narrowed every stroke with
   * the glass, and a round dot was an oval a sixth narrower at the turn's
   * widest -- at sidebar sizes, a dot that changed size as it turned.
   */
  const drawGlyph = (glyph: GlyphShape, motion: GlyphMotion, scale: number, blinkSquash: number, steady?: number): void => {
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = lit
    if (glow !== undefined) {
      context.shadowColor = glow
      context.shadowBlur = 3.2 * paint.pixelsPerUnit
    }
    const weight = traceGlyph(context, glyph, motion, scale, blinkSquash)
    context.lineWidth = weight * scale
    if (steady !== undefined) {
      // The path is where the plane put it; the stroke's weight is laid on flat.
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.lineWidth = weight * steady
    }
    stroke()
  }
  /** An eye's loop this frame, on its state's own clock, eased to its rest as the face settles (EyePaint.restNow). */
  const loopAt = (pair: string, eye: 0 | 1): GlyphMotion => {
    const moving = glyphMotion(pair, eye, seconds - since)
    const k = Math.max(0, Math.min(1, paint.restNow?.() ?? 0))
    if (k <= 0) return moving
    const rest = glyphMotion(pair, eye, 0)
    const mix = (from: number, to: number): number => from + (to - from) * k
    return { dx: mix(moving.dx, rest.dx), dy: mix(moving.dy, rest.dy), sx: mix(moving.sx, rest.sx), sy: mix(moving.sy, rest.sy), shown: k >= 0.5 ? rest.shown : moving.shown }
  }
  /**
   * A SCREEN'S EYES ARE PLACED ON THE SCREEN. The rig moves its eyes for a
   * glance further than a screen is wide, so on a turned head they slid off
   * its edge and were cut away -- a ghost looking aside had no eyes at all
   * (0.561, looked at frame by frame). So on a screen both eyes are drawn
   * here, at the first eye the rig draws: spaced to the screen's own width,
   * drawn flat in its plane, and a glance moves them only as far as the screen
   * has room for.
   */
  const screenEyes = (open: number): void => {
    const boot = booting()
    visor(boot)
    if (face === undefined) return
    // Switching on, the eyes are dark until the flash has settled, then blink open.
    const booted = boot === undefined ? 1 : powerOnEyes(boot)
    if (booted <= 0) return
    const pair = changes.shown().pair ?? SCREEN_RESTING_EYES
    const { scale, centres } = screenEyeLayout(box, pair, look, paint.eyeY ?? 1)
    // As shut as the more shut of its blinks: one of the rig's, should it fall in a change, joins the change's own.
    const squash = 1 - 0.92 * Math.max(1 - open * booted, swapShut)
    for (const eye of [0, 1] as const) {
      const shape = GLYPH_SHAPES[pair[eye]] ?? GLYPH_SHAPES['•']
      const motion = loopAt(pair.join(''), eye)
      if (shape === undefined || !motion.shown) continue
      const [cx, cy] = centres[eye]
      // An eye shut in sleep stays as drawn; only a change-blink closes it further.
      const eyeSquash = shape.closed === true ? 1 - 0.92 * swapShut : squash
      context.save()
      onFront()
      context.globalAlpha = 1
      trace()
      context.clip()
      // The context's own translate: the shadowed one would take this for the face's.
      translate(cx, cy)
      // At rest the front layer is FRONT_RIM of the face's own scale: the weight a glyph has facing you, kept as it turns.
      drawGlyph(shape, motion, scale, eyeSquash, scale * paint.pixelsPerUnit * FRONT_RIM)
      context.restore()
    }
  }
  const glyphAt = (args: unknown[]): void => {
    // The rig draws the left eye first; an eye out of sight is not drawn at all.
    const left = drawn === 0 && !leftHidden
    drawn += 1
    if (screen !== undefined) {
      if (drawn === 1) screenEyes(screenOpenness(eyeOpenness(context.lineWidth)))
      return
    }
    const pair = changes.shown().pair
    const shape = GLYPH_SHAPES[pair?.[left ? 0 : 1] ?? '']
    if (shape === undefined) {
      // Not a glyph we draw: the rig's own eye, in the face's colour.
      context.strokeStyle = lit
      return stroke(...args)
    }
    const squash = (shape.closed === true ? 1 : 0.08 + 0.92 * eyeOpenness(context.lineWidth)) * (1 - 0.92 * swapShut)
    const motion = loopAt(pair?.join('') ?? '', left ? 0 : 1)
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
    // A mouth is drawn in the face's ink too: it keeps the real one. A screen has none (0.574): its eyes and motion say it all.
    if (String(context.fillStyle).toLowerCase() !== GLYPH_INK) return fill(...args)
    if (screen !== undefined) return undefined
    context.fillStyle = paint.ink
    return fill(...args)
  }
  /** The face's change at second `s` (FaceChange), worked out once a frame. */
  const change = (s: number): FaceChange => {
    const now = changes.at(s)
    swapShut = now.shut
    since = now.since
    return now
  }
  return {
    change,
    frame: (pose, s) => {
      drawn = 0
      seconds = s
      change(s)
      if (screen !== undefined) {
        // A flash: its colour as it comes in, easing back to the eyes' own (FLASH_S). A still bot never flashes.
        const light = screenLight(changes.shown().tone, changes.flash(), s)
        lit = light.lit
        glow = light.glow
      }
      // The screen turns with the body's front, all the way (frontPlane).
      plane = frontPlane(pose.yaw, pose.pitch, faceAt)
      // How the body's front moved since the last frame, up and down with its hop: a turn carries the eyes with it.
      const rise = pose.y ?? 0
      const dt = body === undefined ? 0 : s - body.at
      if (s === 0 || body === undefined || dt <= 0 || dt > 0.1) {
        // Still, first drawn, or back from a hidden tab: the eyes sit where they are put.
        lag = LAG_REST
        body = { at: s, y: rise, vy: 0 }
      } else {
        const vy = (rise - body.y) / dt
        lag = stepLag(lag, dt, 0, vy - body.vy)
        body = { at: s, y: rise, vy }
      }
      /*
       * A SCREEN'S EYES KEEP THEIR PLACE ON IT (2026-10-05). The rig's look --
       * its wander, its darts, the lead it gives a turn, the pointer -- slides
       * eyes painted on a sphere, which reads as looking; on a flat screen the
       * same numbers slid two lit dots about the glass, under the dots' own
       * loop, and at sidebar sizes a dot moving a fraction of a pixel a frame
       * changes shape from frame to frame. The rig's look still turns the head
       * (its heading, the pointer, a glance at a teammate), and the screen
       * turns with it; only a hop's weight moves the eyes on the glass.
       */
      look = { x: 0, y: lag.y / 0.5 }
      leftHidden = pose.yaw < LEFT_EYE_HIDDEN_AT
      face = undefined
      front = undefined
    },
    /** Whether this frame draws glyphs (or is blinking between them): the rig must then draw its eyes in GLYPH_INK. */
    drawsGlyphs: () => changes.shown().pair !== undefined || changes.coming()?.pair !== undefined,
    /** What the face shows now (FaceChange's key): the face a change leaves, on the frame it begins. */
    shownKey: () => changes.shown().key
  }
}

/** A screen's eyes when nothing else is asked of them: two lit bars, as the mascot rests. */
export const SCREEN_RESTING_EYES: EyeGlyphs = ['|', '|']

/** How much of the rig's squash and stretch a screen-faced body keeps. */
export const SCREEN_SQUASH = 0.45
/** How far a screen-faced head may turn: its heading is held to this, read or not. */
const SCREEN_YAW_LIMIT = 0.75

/**
 * A SCREEN KEEPS ITS FACE TO YOU (0.568).
 *
 * Colin, 2026-10-03: *"the screen faces are a little janky ... they kind of
 * clip around and go crazy ... might just need some proper motion/screen
 * physics"*. Measured frame by frame (`_tools/look-screen-motion.mjs`), the
 * rig did three things a screen cannot wear:
 *
 * - **It spun.** The working loop turns the body a full circle every third
 *   hop (hard-coded in the rig, not its `spin` setting), and a resting flip
 *   does the same every few seconds: the screen swept round to the back of
 *   the head and its eyes clipped away, then came back. The turn the rig
 *   would have without the spin -- its own heading, glances and the pointer
 *   included -- is kept; the spin is not.
 * - **It laughed.** Every two to four seconds of work the rig narrows its
 *   eyes for most of a second. A screen ignores a shut longer than a blink,
 *   so its glyphs squashed for a third of a second and snapped open again:
 *   `>▮` flickering through `--`. A screen says how it is with its glyphs.
 * - **It squashed hard.** Each landing pressed the body to about four fifths
 *   of its height, the visor and its glyphs with it. A screen keeps a little
 *   under half of that: the hop still lands.
 *
 * Eyes that are the rig's own keep everything (Colin, 2026-09-23: "all that
 * movement is fine and great"). The rig's pose is copied, never changed: it
 * eases from its own last frame.
 *
 * A thinking screen looks about with its head (2026-10-05): `glance` takes the
 * turn and the tilt from the rig's as its mix rises (thinkingGlance), and its
 * targets sit well inside the turn a screen can show.
 */
export function screenPose(pose: BotAvatarPose, heading: number | undefined, glance?: HeadGlance): BotAvatarPose {
  const wrapped = Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw))
  const wander = glance?.wander ?? 1
  const own = Math.max(-SCREEN_YAW_LIMIT, Math.min(SCREEN_YAW_LIMIT, heading ?? wrapped)) * wander
  const ownPitch = pose.pitch * wander
  const mix = glance?.mix ?? 0
  return {
    ...pose,
    yaw: own + ((glance?.yaw ?? own) - own) * mix,
    pitch: ownPitch + ((glance?.pitch ?? ownPitch) - ownPitch) * mix,
    laugh: 0,
    whirl: 0,
    sx: 1 + (pose.sx - 1) * SCREEN_SQUASH,
    sy: 1 + (pose.sy - 1) * SCREEN_SQUASH
  }
}

/** How far a curious head tips (BotMood): bloub's curious face is 15 degrees; a little less on a body. */
export const CURIOUS_TILT = 0.21
/** How far a perked head lifts, radians up. */
export const PERK_LIFT = 0.12

/** Each mood's weight this moment, 0 to 1. */
export interface MoodWeights {
  readonly curious: number
  readonly perked: number
  readonly glad: number
}

/** Which way a teammate's head tips when it is curious: its own side, the same every time. */
export function tiltSide(seed: number): 1 | -1 {
  return Math.floor(seed * 1000) % 2 === 0 ? 1 : -1
}

/**
 * The rig's pose with its moods worn (BotMood), copied, never changed. A
 * glad face of plastic smiles with its eyes: the rig's own laugh, which it
 * draws only in proportion to its working weight -- so the face is lent that
 * weight for its eyes alone while it smiles. A screen says it with `^^`.
 */
export function moodPose(pose: BotAvatarPose, weights: MoodWeights, side: 1 | -1, screen: boolean): BotAvatarPose {
  const glad = screen ? 0 : Math.max(0, Math.min(1, weights.glad))
  const [idle = 1, working = 0, sleeping = 0] = pose.w
  return {
    ...pose,
    roll: pose.roll + side * CURIOUS_TILT * weights.curious,
    pitch: pose.pitch + PERK_LIFT * weights.perked,
    ...(glad > 0 ? { laugh: Math.max(pose.laugh, glad), w: [idle * (1 - glad), working + idle * glad, sleeping] as BotAvatarPose['w'] } : {})
  }
}

/** The shortest the rig waits between one blink of its own and the next (bot-avatars: 2.2 s, and up to 2.6 s more). */
export const BLINK_GAP_S = 2.2

/**
 * A change's blink, counted as the rig's own: kept privately by bot-avatars,
 * so reached defensively. `fire` blinks the rig's eyes now (a face of
 * plastic); without it the change has blinked already (a screen's swap). Either
 * way the rig's next blink of its own is put off as after any of its blinks:
 * frame by frame, its own fell a few frames after a change's often enough
 * that a change blinked twice.
 */
export function blinkNow(sim: BotAvatarSim | null, fire = true): boolean {
  const rig = sim as unknown as { readonly blink?: { readonly fire?: unknown; readonly active?: unknown }; blinkAt?: unknown; readonly t?: unknown } | null
  const blink = rig?.blink
  if (rig === null || blink === undefined || typeof blink.fire !== 'function') return false
  // A blink under way runs on: fired again it would spring open and shut a second time.
  if (fire && blink.active !== true) (blink.fire as () => void).call(blink)
  if (typeof rig.blinkAt === 'number' && typeof rig.t === 'number') rig.blinkAt = Math.max(rig.blinkAt, rig.t + BLINK_GAP_S)
  return true
}

/** The rig's heading without its spins: kept privately by bot-avatars, so read defensively. A pet's puppet reads it too. */
export function headingOf(sim: BotAvatarSim): number | undefined {
  const heading = (sim as unknown as { readonly baseYaw?: unknown }).baseYaw
  return typeof heading === 'number' && Number.isFinite(heading) ? heading : undefined
}

/** What a body is asked for this frame. */
export interface BodyWants {
  /** The mood asked for now (BotMood). */
  readonly mood: BotMood | undefined
  /** A hop asked for (BotProps.hop) and not yet taken. */
  readonly hop: boolean
  /** A handoff glance (BotProps.glance) holds now. */
  readonly glancing: boolean
  /** Asked to keep still (BotProps.paused): it settles to rest once its eyes have done their change, then rests. */
  readonly resting: boolean
}

/** What a body does this frame. */
export interface BodyFrame {
  /** The pose to draw: the rig's, kept to a screen (screenPose), looking about in thought, wearing its mood. */
  readonly pose: BotAvatarPose
  /** A change began this frame: its blink counts as the rig's own (blinkNow), whoever blinks it. */
  readonly changed: boolean
  /** Blink the rig's own eyes now: a face of plastic, beginning a change. */
  readonly blink: boolean
  /** Take the hop asked for now: the change that asked for it has opened its eyes. */
  readonly hop: boolean
  /** How far it has settled to rest: 0 moving, 1 at rest (EyePaint.restNow). */
  readonly rest: number
  /** Nothing about it is still easing: no change under way, its mood, its look and its rest arrived. */
  readonly settled: boolean
}

/**
 * The rig's pose eased `k` of the way to rest (0 none, 1 all): facing you,
 * upright, its own size, looking ahead -- the pose a still bot is drawn in.
 * Its blinks are its own and are kept.
 */
export function restedPose(pose: BotAvatarPose, k: number): BotAvatarPose {
  if (k <= 0) return pose
  const keep = 1 - Math.min(1, k)
  return {
    ...pose,
    yaw: pose.yaw * keep,
    pitch: pose.pitch * keep,
    roll: pose.roll * keep,
    x: pose.x * keep,
    y: pose.y * keep,
    sx: 1 + (pose.sx - 1) * keep,
    sy: 1 + (pose.sy - 1) * keep,
    lookX: pose.lookX * keep,
    lookY: pose.lookY * keep,
    breath: pose.breath * keep,
    laugh: pose.laugh * keep,
    whirl: pose.whirl * keep
  }
}

/**
 * THE BODY ANSWERS A CHANGE (FaceChange, step 4). Each frame it is handed
 * where the face's change is, and the rig's own pose: it answers with the
 * pose to draw, and says when to blink and when to hop. What it wears -- its
 * mood, whether its head looks about in thought, and since when -- it takes
 * up only once a change has opened its eyes, so through the blink the body
 * holds what it was doing, and a thinking look runs on in its own time as it
 * fades out.
 *
 * A HANDOFF GLANCE WINS (2026-10-05). A thinking face held its own turning
 * back for its look about (THINKING_HUSH), and the look took the head: so a
 * teammate deep in thought barely turned to the one handing it a message,
 * the moment the two are meant to be seen to meet. While a glance holds
 * (GLANCE_HOLD_MS) the look fades out and the head is the rig's, turned to
 * the glance; then the look fades back in, its loop having run on.
 *
 * A FACE SETTLES BEFORE IT RESTS (2026-10-05). A still bot was a different
 * drawing: going still rebuilt the rig, and waking rebuilt it again, so the
 * commonest change there is -- an idle teammate starting to think -- had no
 * blink at all: the bars were gone and the dots there, mid-loop. Now a face
 * asked to keep still (`resting`) answers that like any change: once its eyes
 * are open on it, its head, its body and its eyes' loop ease to rest (facing
 * you, as a still bot was drawn), and when it has `settled` its clock can
 * stop. Woken, it eases back out on the same rig.
 */
export function bodyConductor(seed: number, screen: boolean, still: boolean, restingAtStart = false): {
  readonly frame: (seconds: number, change: FaceChange, rig: BotAvatarPose, heading: number | undefined, wants: BodyWants) => BodyFrame
} {
  // How much a thinking face's look has the head: eased in and out as its dots come and go, never a jump.
  const thinking = easedValue(0, HEAD_GLANCE_S)
  // Each mood's weight, eased the same way as it comes and goes (BotMood).
  const moods = { curious: easedValue(0, HEAD_GLANCE_S), perked: easedValue(0, HEAD_GLANCE_S), glad: easedValue(0, HEAD_GLANCE_S) }
  // How far it has settled to rest: a face that first appears resting is at rest from its first frame.
  const rest = easedValue(restingAtStart ? 1 : 0, HEAD_GLANCE_S)
  const lean = tiltSide(seed)
  let answered: { readonly mood: BotMood | undefined; readonly thinking: boolean; readonly since: number; readonly resting: boolean } = {
    mood: undefined,
    thinking: false,
    since: 0,
    resting: restingAtStart
  }
  let blinked = 0
  return {
    frame: (seconds, change, rig, heading, wants) => {
      // One blink a change: a screen's is its own swap (SWAP_S); a face of plastic blinks the rig's eyes as it begins.
      const changed = change.count !== blinked
      const blink = changed && !screen
      blinked = change.count
      let hop = false
      if (change.open) {
        const dots = change.eyes?.join('') === '••'
        answered = { mood: wants.mood, thinking: dots, since: dots ? change.since : answered.since, resting: wants.resting }
        hop = wants.hop && !still
      }
      thinking.set(answered.thinking && !wants.glancing ? 1 : 0, seconds)
      const glance = thinkingGlance(seconds - answered.since)
      const thought = thinking.at(seconds)
      // A still bot wears its mood outright; a moving one eases into it once the change has opened its eyes.
      const weight = (key: BotMood): number => {
        if (still) return wants.mood === key ? 1 : 0
        moods[key].set(answered.mood === key ? 1 : 0, seconds)
        return moods[key].at(seconds)
      }
      const worn = { curious: weight('curious'), perked: weight('perked'), glad: weight('glad') }
      rest.set(answered.resting ? 1 : 0, seconds)
      const rested = still ? 1 : rest.at(seconds)
      // A screen keeps its face to you: no spin, no laugh, a softer squash (screenPose); a thinking one looks about,
      // the rig's own turning held back meanwhile. Either settles to rest as it is asked to keep still, and either
      // face wears its mood on top (moodPose).
      const pose = moodPose(
        restedPose(screen ? screenPose(rig, heading, { ...glance, mix: glance.mix * thought, wander: 1 - THINKING_HUSH * thought }) : rig, rested),
        worn,
        lean,
        screen
      )
      const settled =
        change.quiet &&
        thinking.settled(seconds) &&
        rest.settled(seconds) &&
        moods.curious.settled(seconds) &&
        moods.perked.settled(seconds) &&
        moods.glad.settled(seconds) &&
        // Never frozen mid-blink.
        Math.max(rig.blinkL, rig.blinkR) < 0.01
      return { pose, changed, blink, hop, rest: rested, settled }
    }
  }
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

/*
 * PLUSH, SMALL (0.577). The library's own fabric is dark and fuzzy at 20-34
 * px and fine from about 40 (look-bot-shading.mjs, measured 10/03): its
 * fibres are longer than a pixel there and read as fuzz. Below 40 px on
 * screen a shorter, combed pile, lit more from the front, stays a clean
 * plush -- one material from the sidebar to the cover, not plastic in one
 * place and fur in the other. Colin accepted this 10/03 (Plush optional;
 * short pile under ~40 px, stock fabric above).
 */
export const PLUSH_SHORT_BELOW = 40
const SHORT_PILE = { length: 0.45, density: 1, fuzz: 0.2, clumps: 0.2, curl: 0.4, gravity: 0.6 }
const SHORT_PILE_LIGHT_FRONT = 72

export function Bot(props: BotProps): ReactElement {
  if (props.size > SUPERSAMPLE_AT_OR_BELOW) return <RiggedBot {...props} />
  return (
    <span className="lc-bot__supersample" style={{ width: props.size, height: props.size }}>
      <span className="lc-bot__supersample-inner" style={{ width: props.size * 2, height: props.size * 2 }}>
        <RiggedBot {...props} size={props.size * 2} shownAt={props.size} />
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

/**
 * EACH THIN PART ITS OWN SOLID (0.577, bot-avatars 0.2). The library's mech
 * keeps both antennae in one path; 0.2 extrudes a single path as one solid,
 * and the two drew as a black scribble between them. Handed a list, it draws
 * each piece on its own. Split at each absolute move: every piece of a part
 * starts with one.
 */
export function partPieces(parts: string): readonly string[] {
  return parts.split(/(?=M)/).map((piece) => piece.trim()).filter((piece) => piece.length > 0)
}

export function partPaths(parts: string): Path2D | Path2D[] {
  const pieces = partPieces(parts)
  return pieces.length === 1 ? new Path2D(pieces[0]) : pieces.map((piece) => new Path2D(piece))
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

/** Where the pointer is on the page, for a face that follows it (NaN before it has moved); a pet's puppet reads it too. */
export function pointerNow(): { readonly x: number; readonly y: number } {
  return pointer
}

export function watchPointer(): void {
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

/** Frames in a row a face asked to keep still must be settled before its clock stops: a third of a second at 30 a second. */
export const SETTLED_FRAMES = 10

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
 * Whether the window is in front, for a bot's clock (0.611): windowPresence.ts.
 * The cover already rested behind other windows (HomeCover, 0.305); the faces
 * beside a run did not, and were drawn 30 times a second for nobody.
 */
export type BotPresence = WindowPresence

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
 *
 * While the window is behind other windows the clock asks for no frames at
 * all: the face holds where it was, and picks up from there when the window
 * comes back, with no jump for the time it was away (0.611).
 */
export function startBotClock(
  draw: () => void,
  step: (seconds: number) => void,
  showing: () => boolean,
  frames: BotFrames = {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now()
  },
  presence: BotPresence = WINDOW_PRESENCE
): () => void {
  draw()
  let last = frames.now()
  let handle = 0
  let stopped = false
  // A millisecond of slack, so a 60 Hz screen's second frame (33.3 ms) is not
  // turned away for arriving a hair early.
  const every = 1000 / BOT_FRAMES_PER_SECOND - 1
  const tick = (now: number): void => {
    handle = 0
    // A frame too soon after the last is passed over, and its time goes to the next.
    if (now - last >= every) {
      const seconds = Math.min(0.05, (now - last) / 1000)
      last = now
      if (showing()) {
        step(seconds)
        draw()
      }
    }
    if (!stopped && !presence.away()) handle = frames.requestAnimationFrame(tick)
  }
  const unwatch = presence.watch(() => {
    if (stopped) return
    if (presence.away()) {
      if (handle !== 0) frames.cancelAnimationFrame(handle)
      handle = 0
    } else if (handle === 0) {
      // Back in front: the time it was away is not stepped through.
      last = frames.now()
      handle = frames.requestAnimationFrame(tick)
    }
  })
  if (!presence.away()) handle = frames.requestAnimationFrame(tick)
  return () => {
    stopped = true
    unwatch()
    if (handle !== 0) frames.cancelAnimationFrame(handle)
  }
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
/**
 * ONE MEASURE FOR EVERY FACE (0.573).
 *
 * Each face anchored itself as it was drawn: two `getBoundingClientRect`
 * reads, then CSS variables written on its box. A conversation draws a face
 * beside its turns -- 86 in one of Colin's -- and every read after the face
 * before it had written laid the whole page out again, so clicking into that
 * conversation froze the window for 0.7-0.8 s, every time
 * (`_tools/profile-real-switch.mjs` on a copy of his ledger; his report:
 * "hitching/lagging when clicking between two working sessions"). Faces now
 * wait for the next frame, which measures every waiting face before any of
 * them writes: one layout, however many faces.
 */
export interface AnchorJob {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly key: string
  readonly settle: (anchored: boolean) => void
}
const anchorQueue: AnchorJob[] = []
let anchorFrame = 0

export function anchorSoon(job: AnchorJob): void {
  anchorQueue.push(job)
  if (anchorFrame !== 0) return
  anchorFrame = requestAnimationFrame(() => {
    anchorFrame = 0
    const jobs = anchorQueue.splice(0)
    // Every read first...
    const measured = jobs.map((job) => (job.canvas.isConnected ? measureBody(job.canvas, job.context, job.key) : true))
    // ...then every write.
    jobs.forEach((job, at) => {
      const one = measured[at]
      if (typeof one === 'boolean') {
        job.settle(one)
        return
      }
      for (const [name, value] of Object.entries(one.variables)) one.host.style.setProperty(name, value)
      job.settle(true)
    })
  })
}

/**
 * Where the ring and dot go on this face, read from the page; true when there
 * is nothing to place, false when it is not laid out yet. Reads only.
 */
function measureBody(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  key: string
): { readonly host: HTMLElement; readonly variables: Readonly<Record<string, string>> } | boolean {
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
  return { host, variables: anchorVariables(anchorsOf(body)) }
}

function RiggedBot({
  type,
  size,
  color,
  state = 'default',
  paused = false,
  motionPresence = WINDOW_PRESENCE,
  face,
  seed = 0.37,
  interactive = false,
  follows = false,
  jumpEvery,
  hop = false,
  glance,
  eyes,
  phosphor,
  flash,
  screen: screenChoice,
  mood,
  blinkKey,
  bootKey,
  crt,
  shownAt
}: BotProps & { readonly shownAt?: number }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null)
  const rig = useRef<BotAvatarSim | null>(null)
  const glyphs = useRef(eyes)
  // Read each frame, so a mood eases in and out on the running rig (BotMood).
  const feeling = useRef(mood)
  feeling.current = mood
  // What the face is doing (blinkKey), read each frame: a new one is a change it performs (FaceChange).
  const doing = useRef(blinkKey)
  doing.current = blinkKey
  // A screen's power-on (POWER_ON_S): asked for once a session per face, and when on this bot's clock it begins.
  const bootWanted = useRef(false)
  const bootAt = useRef<number | undefined>(undefined)
  // How long it runs (POWER_ON_S, or a change's CRT_FLICK_S), and which changes bring one in (BotProps.crt), read at each change.
  const bootSpan = useRef(POWER_ON_S)
  const crtRule = useRef(crt)
  crtRule.current = crt
  // The rig's own clock (seconds it has been stepped), and when a hop's held-back spin returns on it.
  const rigTime = useRef(0)
  const spinBackAt = useRef<number | undefined>(undefined)
  // A hop asked for (`hop`), taken once the eyes are open on the change that asked for it (FaceChange).
  const hopWanted = useRef(false)
  // Asked to keep still (`paused`), read each frame: the face settles, then rests (BodyWants.resting).
  const resting = useRef(paused)
  resting.current = paused
  // Starts a resting face's clock again, to perform something new; draws a still one (reduced motion) again.
  const wake = useRef<(() => void) | undefined>(undefined)
  // Terminal faces on (Settings > Appearance): a teammate wears a screen as it chose, or as its shape suits.
  const terminal = useTerminalFaces()
  const screen = outlineOf(type).screen || (terminal && (screenChoice ?? screenSuits(type)))
  // A screen has no mouth (0.574). Colin: "i think we can ditch the smile if we have the screen, it seems to interfere".
  const faceShown: BotAvatarFace | undefined = screen ? 'eyes' : face
  // Plush on (Settings > Appearance): fur, with a short pile where the bot is small on screen (PLUSH_SHORT_BELOW).
  const plush = usePlush()
  const shortPile = plush && (shownAt ?? size) < PLUSH_SHORT_BELOW
  /*
   * CODE EYES ARE A SCREEN'S (0.562). Colin: "maybe also a toggle for the
   * computer eyes as well, or should the computer eyes be exclusive to the
   * terminal screen?" Exclusive. Lit on a screen they read as a terminal's
   * output; inked straight onto plastic they were the "text for eyes" he
   * turned down in the first place. A face with no screen keeps the rig's own
   * eyes -- blinking, glancing, laughing -- and says its state with its ring,
   * dot and hop. A screen with nothing asked of it rests on two lit bars.
   */
  glyphs.current = screen ? eyes ?? SCREEN_RESTING_EYES : undefined
  const glowing = useRef(phosphor)
  glowing.current = phosphor
  const flashed = useRef(flash)
  flashed.current = flash
  // What each frame reads, so a glance or the pointer never restarts the rig.
  const aim = useRef<{ follows: boolean; glance: Glance | undefined; glancedAt: number }>({
    follows: interactive || follows,
    glance: undefined,
    glancedAt: 0
  })

  // Declared before the rig's effect, so the very first frame of a face that powers on is already dark.
  useEffect(() => {
    if (!firstBoot(bootKey)) return
    bootWanted.current = true
  }, [bootKey])

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
    const parts = outline.parts === undefined ? undefined : partPaths(outline.parts)
    warmBotAvatarPlastic(outline.key, path, size * dpr, undefined, plush, shortPile ? SHORT_PILE : undefined)
    const sim = new BotAvatarSim(seed, state)
    sim.setTurn(outline.turn)
    // BotAvatar takes `jumpEvery` as a prop; the rig is set the same way, so
    // a subtle bot never flips.
    if (jumpEvery !== undefined) sim.setJump({ every: jumpEvery })
    rig.current = sim
    // Reduced motion: drawn still, at its loops' rest, and drawn again for whatever it is asked to show next (`wake`).
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    // How far the face has settled to rest this frame (BodyFrame.rest), for its eyes' loops.
    let restNow = resting.current ? 1 : 0
    // Read at each frame, so a teammate's eyes change with what it does without restarting its rig.
    const painter = withGlyphEyes(context, () => glyphs.current, {
      ink,
      phosphorNow: () => glowing.current ?? 'cyan',
      flashNow: () => flashed.current,
      screenOf: screen ? body : undefined,
      visor: visorOf(outline, faceShown ?? outline.face, path),
      // The rig's eye height for each face (its own `eyes: 1, mouth: -3.5`).
      eyeY: (faceShown ?? outline.face) === 'mouth' ? -3.5 : 1,
      faceAt: { x: outline.faceX, y: outline.faceY, scale: outline.faceScale },
      // The face is drawn at size / 100 a unit (times its own scale), at dpr device pixels a CSS pixel.
      pixelsPerUnit: (size / 100) * outline.faceScale * dpr,
      bootAt: () => bootAt.current,
      bootSpan: () => bootSpan.current,
      keyNow: () => doing.current,
      restNow: () => restNow
    })
    // What the body does with each change, once its eyes have done theirs (FaceChange): its mood, its hop, its look.
    const answer = bodyConductor(seed, screen, still, resting.current)
    // The clock while it runs (startBotClock), and how many frames in a row nothing has been easing.
    let stop: (() => void) | undefined
    let settledFor = 0
    let gone = false
    // The next frame drawn as a still bot's (second 0: its change done at once), for a face woken where it cannot move.
    let atOnce = false
    const draw = (): void => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, side, side)
      // A still bot is drawn at its loops' rest; a moving one on its own clock, offset so a row does not move in unison.
      const seconds = still || atOnce ? 0 : performance.now() / 1000 + seed * 17
      atOnce = false
      // A screen asked to switch on does so from this frame, a row of them a moment apart (by seed): a cascade.
      if (bootWanted.current && !still) {
        bootWanted.current = false
        bootAt.current = seconds + seed * 0.35
        bootSpan.current = POWER_ON_S
      }
      // The face's change first (its eyes shut, swap and open), then what the body does about it.
      const change = painter.change(seconds)
      const { pose, changed, blink, hop: hopNow, rest, settled } = answer.frame(seconds, change, sim.pose, headingOf(sim), {
        mood: feeling.current,
        hop: hopWanted.current,
        glancing: aim.current.glance !== undefined && performance.now() - aim.current.glancedAt < GLANCE_HOLD_MS,
        resting: resting.current
      })
      restNow = rest
      if (changed) {
        blinkNow(sim, blink)
        // A change worth looking up for comes in as the screen switching on again (CrtChange); a still bot just changes.
        const kind = screen && seconds !== 0 ? crtRule.current?.(painter.shownKey(), doing.current, change.count) : undefined
        if (kind !== undefined) {
          bootAt.current = seconds
          bootSpan.current = kind === 'on' ? POWER_ON_S : CRT_FLICK_S
        }
      }
      if (hopNow) {
        hopWanted.current = false
        sim.setJump(GLAD_HOP)
        sim.poke()
        spinBackAt.current = rigTime.current + HOP_MS / 1000
      }
      painter.frame(pose, seconds)
      drawBotAvatarFrame(context, size, pose, {
        path,
        ...(parts === undefined ? {} : { parts }),
        ...(outline.partsDepth === undefined ? {} : { partsDepth: outline.partsDepth }),
        typeKey: outline.key,
        face: faceShown ?? outline.face,
        faceX: outline.faceX,
        faceY: outline.faceY,
        faceScale: outline.faceScale,
        color: body,
        ink: painter.drawsGlyphs() ? GLYPH_INK : ink,
        shading: plush ? 'fabric' : 'plastic',
        ...(shortPile ? { fur: SHORT_PILE, lightFront: SHORT_PILE_LIGHT_FRONT } : {}),
        dpr,
        theme: 'dark',
        still
      })
      /*
       * A FACE ASKED TO KEEP STILL RESTS ONCE IT HAS SETTLED (2026-10-05): its
       * change performed, its body eased to rest, its hop landed, its screen
       * on, and a few frames more for the plastic's light to settle with it.
       * Its clock stops there, the frame it rests in left drawn, and it costs
       * nothing until it is asked for something new (`wake`).
       */
      settledFor = settled && spinBackAt.current === undefined && !hopWanted.current ? settledFor + 1 : 0
      if (resting.current && settledFor >= SETTLED_FRAMES && stop !== undefined) {
        stop()
        stop = undefined
      }
    }
    let anchored = false
    let waiting = false
    // Measured with every other face in the next frame (anchorSoon), not here.
    const anchor = (): void => {
      if (anchored || waiting) return
      waiting = true
      anchorSoon({
        canvas,
        context,
        key: `${outline.key}|${state}`,
        settle: (done) => {
          waiting = false
          if (!gone) anchored = done
        }
      })
    }
    if (still) {
      draw()
      anchor()
      wake.current = draw
      return () => {
        wake.current = undefined
        rig.current = null
      }
    }
    watchPointer()
    let onScreen = true
    const step = (seconds: number): void => {
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
        // The rig's own clock, as the rig counts it (it takes at most 0.05 s a step).
        rigTime.current += Math.min(0.05, seconds)
        const restoreAt = spinBackAt.current
        if (restoreAt !== undefined && rigTime.current >= restoreAt) {
          spinBackAt.current = undefined
          sim.setJump({ spin: botAvatarJumpDefaults.spin, squashEase: botAvatarJumpDefaults.squashEase, riseEase: botAvatarJumpDefaults.riseEase })
        }
    }
    // The clock, from where the face rests: it picks up with no jump for the time it was stopped.
    const run = (): void => {
      if (stop !== undefined || gone) return
      settledFor = 0
      /*
       * Woken where its clock may not run -- the window behind others, or the
       * surface it is on resting (motionPresence) -- it could draw one frame
       * of its change and no more: the eyes it had, a blink begun. So that one
       * frame is drawn as a still bot's, its new face at once; it moves on from
       * there when its clock runs again.
       */
      atOnce = motionPresence.away()
      stop = startBotClock(draw, step, () => onScreen && document.visibilityState !== 'hidden', undefined, motionPresence)
    }
    wake.current = run
    run()
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
      gone = true
      stop?.()
      stop = undefined
      wake.current = undefined
      watch?.disconnect()
      rig.current = null
    }
    // A new state, new eyes, keeping still or not: each is performed on the running rig (below), never a rebuilt one.
  }, [type, size, color, faceShown, seed, screen, plush, shortPile, motionPresence])

  useEffect(() => {
    rig.current?.setState(state)
  }, [state])

  // How often it flips on its own, set on the running rig too: a face woken from rest flips only if it is asked to.
  useEffect(() => {
    rig.current?.setJump({ every: jumpEvery ?? botAvatarJumpDefaults.every })
  }, [jumpEvery])

  /*
   * ANYTHING NEW WAKES IT (2026-10-05). Whatever a face is asked to show --
   * its eyes, their colour or flash, its mood, what it is doing, its state, a
   * hop, keeping still or not -- a resting face wakes to perform, on its own
   * rig, and rests again once it has settled. A face drawn still (reduced
   * motion) is drawn again: it used to keep the eyes it first had while its
   * teammate went from thinking to working.
   */
  const asked = [eyes?.join('') ?? '', phosphor ?? '', flash ?? '', mood ?? '', blinkKey ?? '', state, paused ? 'still' : 'moving', hop ? 'hop' : ''].join('|')
  useEffect(() => {
    wake.current?.()
  }, [asked])

  useEffect(() => {
    aim.current.follows = interactive || follows
    if (follows) wake.current?.()
  }, [interactive, follows])

  // A glance starts its hold when it is given, and again for a new one.
  useEffect(() => {
    aim.current.glance = glance
    aim.current.glancedAt = performance.now()
    wake.current?.()
  }, [glance?.x, glance?.y])

  /*
   * A hop is the library's own jump -- the crouch, the stretch in the air,
   * the squash on landing -- with no turn in it: a click's jump spins right
   * round, which is a flip, and a teammate that just finished is not
   * showing off. The turn comes back once it has landed, and not before,
   * whenever the hop's moment ends. Declared after the rig's effect, so a
   * bot woken for its hop hops on the rig just made.
   */
  /*
   * THE TURN COMES BACK ON THE RIG'S CLOCK, NOT THE WALL'S (0.562). It came
   * back on a 1.5 s timer; the rig advances at most 0.05 s a frame, so when
   * frames come slowly -- a busy machine, a window half covered, a hidden one
   * -- the hop was still in the air when the spin came back, and the bot
   * turned part way round mid-hop and finished the turn slowly, faceless
   * (the title screen's Prompt, look-cover.mjs, every frame after its hop).
   * Now the spin returns once the RIG has lived HOP_MS since the hop.
   *
   * AND IT WAITS FOR THE EYES (2026-10-05). It is a glad hop (GLAD_HOP, the
   * library's own bounce), taken by the running rig once the change that asked
   * for it has opened its eyes (FaceChange): it used to leave the ground while
   * the eyes were still changing. The rig's draw takes it; this only asks.
   */
  useEffect(() => {
    hopWanted.current = hop
  }, [hop])

  const box = size * BOT_AVATAR_OVERSCAN
  const pull = ((BOT_AVATAR_OVERSCAN - 1) / 2) * size
  return (
    <canvas
      ref={ref}
      aria-hidden
      // What it wears, for a drive to read beside the pixels: a screen, or its own eyes.
      data-face={screen ? 'screen' : 'eyes'}
      data-material={plush ? (shortPile ? 'plush-short' : 'plush') : 'plastic'}
      onClick={
        interactive
          ? () => {
              rig.current?.poke()
              wake.current?.()
            }
          : undefined
      }
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
