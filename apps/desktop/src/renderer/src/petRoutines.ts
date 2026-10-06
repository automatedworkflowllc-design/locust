import { REST_ARM, REST_TARGET } from './buddyRig.js'
import type { ArmPose, RigTarget } from './buddyRig.js'
import { LOOK_ABOUT_S, THINKING_CYCLE_S } from './components/Bot.js'
import type { EyeGlyphs } from './components/Bot.js'
import { seeded } from './faceLife.js'
import type { IdleMoment, MomentPick } from './faceLife.js'
import type { GlanceSide } from './glances.js'

/**
 * HIS MOVES, ON HIS OWN RIG (2026-10-05, buddyRig.ts).
 *
 * Colin, of Codex Buddy: *"maybe has more lifting animations"*, then *"we can
 * figure out a way to cycle in all his lifting animations as well"*. He lifts
 * in SETS: into the lift, its rep a few times, out of it, a breather between.
 * Working, he goes round all of them, each time he starts work from the next
 * set on (a short task still shows a new lift); at rest his own moments now
 * and then are a short set of each in turn (`buddyMoment`), so nobody needs a
 * long task to see them.
 *
 * Until 0.653 each move was a row of his maker's drawings, three to five to
 * a lift; now a move is a pose at every moment -- his arms' joints, his
 * body's dip, where his eyes look -- eased from pose to pose, and his rig
 * follows it on springs. Every lift is one he does standing and facing you,
 * so the weights stay in the picture however close he is framed (his maker's
 * bench, pull-up bar and walks went with the drawings). The screen on his
 * face says what he is doing with the bots' own eyes; the body only lifts.
 */

/** A move: where he is at each moment of one pass. */
export interface Move {
  readonly name: string
  /** One pass, in ms. */
  readonly ms: number
  /** What his rig is asked for `ms` into a pass (0 to the move's `ms`). */
  readonly at: (ms: number) => RigTarget
  /** Begins again from its start (or its next set's, `sets`) when it ends. */
  readonly loops: boolean
  /** Played once, it holds where it ends (stuck under the weights); otherwise it ends at his rest. */
  readonly holds?: boolean
  /** Where each set begins, in ms, for a move that goes round several: it starts each time from the next. */
  readonly sets?: readonly number[]
  /** Each set's lift, in the order of `sets`. */
  readonly lifts?: readonly string[]
  /** What a still face (reduced motion) shows for it. */
  readonly still: RigTarget
}

/** A stretch of a move: `ms` long, and where he is `k` of the way through it (0 to 1). */
interface Piece {
  readonly ms: number
  readonly at: (k: number) => RigTarget
}

/** Eased in and out (smoothstep), 0 to 1. */
export function ease(t: number): number {
  const k = Math.max(0, Math.min(1, t))
  return k * k * (3 - 2 * k)
}

const mixArm = (a: ArmPose, b: ArmPose, k: number): ArmPose => ({
  abduct: a.abduct + (b.abduct - a.abduct) * k,
  flex: a.flex + (b.flex - a.flex) * k,
  bend: a.bend + (b.bend - a.bend) * k,
  bendUp: a.bendUp + (b.bendUp - a.bendUp) * k,
  grip: a.grip + (b.grip - a.grip) * k
})

/**
 * A point `t` (0 to 1) along a smooth way through an arm's `points`: a
 * Catmull-Rom curve, through every one of them -- the safe poses it was
 * routed by -- with no corner anywhere, so the hand never turns sharply.
 */
function curveAt(points: readonly ArmPose[], t: number): ArmPose {
  const n = points.length
  const first = points[0] as ArmPose
  if (n <= 2) return mixArm(first, points[n - 1] ?? first, t)
  const spans = n - 1
  const u = Math.min(spans - 1e-9, Math.max(0, t) * spans)
  const i = Math.floor(u)
  const k = u - i
  const p1 = points[i] as ArmPose
  const p2 = points[i + 1] as ArmPose
  // Past either end, the end mirrored: the curve leaves the first point toward the second, and arrives at the last from the one before.
  const p0 = points[i - 1] ?? mixArm(p2, p1, 2)
  const p3 = points[i + 2] ?? mixArm(p1, p2, 2)
  const k2 = k * k
  const k3 = k2 * k
  const at = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (c - a) * k + (2 * a - 5 * b + 4 * c - d) * k2 + (3 * b - a - 3 * c + d) * k3)
  return {
    abduct: at(p0.abduct, p1.abduct, p2.abduct, p3.abduct),
    flex: at(p0.flex, p1.flex, p2.flex, p3.flex),
    bend: at(p0.bend, p1.bend, p2.bend, p3.bend),
    bendUp: at(p0.bendUp, p1.bendUp, p2.bendUp, p3.bendUp),
    grip: at(p0.grip, p1.grip, p2.grip, p3.grip)
  }
}

const WAY_SAMPLES = 24

function smoothWay(points: readonly ArmPose[], k: number): ArmPose {
  if (k <= 0) return points[0] as ArmPose
  if (k >= 1) return points[points.length - 1] as ArmPose
  const along: number[] = [0]
  let last = curveAt(points, 0)
  for (let i = 1; i <= WAY_SAMPLES; i += 1) {
    const next = curveAt(points, i / WAY_SAMPLES)
    along.push((along[i - 1] ?? 0) + jointGap(last, next))
    last = next
  }
  const total = along[WAY_SAMPLES] ?? 0
  if (total <= 0) return curveAt(points, k)
  const want = k * total
  let i = 1
  while (i < WAY_SAMPLES && (along[i] ?? 0) < want) i += 1
  const a = along[i - 1] ?? 0
  const b = along[i] ?? a
  return curveAt(points, (i - 1 + (b > a ? (want - a) / (b - a) : 0)) / WAY_SAMPLES)
}

/** How far apart two arm poses are, by their joints (the weight's roll aside). */
const jointGap = (a: ArmPose, b: ArmPose): number => Math.hypot(a.abduct - b.abduct, a.flex - b.flex, a.bend - b.bend, a.bendUp - b.bendUp)

/** `k` of the way from one target to another. */
export function mixTarget(a: RigTarget, b: RigTarget, k: number): RigTarget {
  // Exactly at either end, so a move that ends on a pose ends on it.
  if (k <= 0) return a
  if (k >= 1) return b
  return {
    pose: { left: mixArm(a.pose.left, b.pose.left, k), right: mixArm(a.pose.right, b.pose.right, k), dip: a.pose.dip + (b.pose.dip - a.pose.dip) * k },
    look: a.look + (b.look - a.look) * k
  }
}

/** Both arms in one pose, his body dipped `dip`, his eyes ahead. */
const both = (arm: ArmPose, dip = 0, look = 0): RigTarget => ({ pose: { left: arm, right: arm, dip }, look })
/** Each arm its own: the picture's left, then its right. */
const each = (left: ArmPose, right: ArmPose, dip = 0, look = 0): RigTarget => ({ pose: { left, right, dip }, look })
const withLook = (target: RigTarget, look: number): RigTarget => ({ ...target, look })

const hold = (target: RigTarget, ms: number): Piece => ({ ms, at: () => target })
const glide = (from: RigTarget, to: RigTarget, ms: number): Piece => ({ ms, at: (k) => mixTarget(from, to, ease(k)) })
/** Through `via` on the way, eased from end to end. */
const through = (from: RigTarget, via: RigTarget, to: RigTarget, ms: number): Piece => ({
  ms,
  at: (k) => {
    if (k <= 0) return from
    if (k >= 1) return to
    const t = ease(k)
    const near = (a: number, b: number, c: number): number => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c
    return {
      pose: { left: smoothWay([from.pose.left, via.pose.left, to.pose.left], t), right: smoothWay([from.pose.right, via.pose.right, to.pose.right], t), dip: near(from.pose.dip, via.pose.dip, to.pose.dip) },
      look: near(from.look, via.look, to.look)
    }
  }
})
const times = (pieces: readonly Piece[], n: number): readonly Piece[] => Array.from({ length: n }, () => pieces).flat()

/** A move from its pieces. */
function moveOf(
  name: string,
  pieces: readonly Piece[],
  how: { readonly loops: boolean; readonly holds?: boolean; readonly still: RigTarget; readonly sets?: readonly number[]; readonly lifts?: readonly string[] }
): Move {
  const ms = pieces.reduce((sum, piece) => sum + piece.ms, 0)
  const at = (into: number): RigTarget => {
    let left = Math.max(0, into)
    for (const piece of pieces) {
      if (left < piece.ms) return piece.at(left / piece.ms)
      left -= piece.ms
    }
    const last = pieces[pieces.length - 1]
    return last === undefined ? REST_TARGET : last.at(1)
  }
  return { name, ms, at, loops: how.loops, holds: how.holds, sets: how.sets, lifts: how.lifts, still: how.still }
}

const P = Math.PI
/** His poses, an arm's each: measured so the weights stay inside his closest framing (petWindow). */
export const POSES = {
  rest: REST_ARM,
  /** A curl at the top: the forearm up toward you, the weight at his chest. */
  curl: { abduct: 0.3, flex: 0.25, bend: 2.4, bendUp: 0, grip: 0 },
  /** The same with the bar up and down. */
  hammer: { abduct: 0.3, flex: 0.25, bend: 2.4, bendUp: 0, grip: P / 2 },
  hammerHang: { ...REST_ARM, grip: P / 2 },
  /** A press's start: the weights at his shoulders, his elbows out. */
  rack: { abduct: 1.6, flex: 0.5, bend: 2.35, bendUp: 0.9, grip: 0 },
  /** Halfway up, the weights straight above where they started. */
  press: { abduct: 2.0, flex: 0.3, bend: 1.75, bendUp: 1, grip: 0 },
  /** Locked out over his head. */
  lockout: { abduct: 2.8, flex: 0.15, bend: 0.25, bendUp: 1, grip: 0 },
  /** A squat's arms: out in front for balance. */
  squat: { abduct: 0.15, flex: 0.75, bend: 0.3, bendUp: 0, grip: 0 },
  /** A double-biceps flex, the weights up beside his head. */
  flex: { abduct: 1.35, flex: 0.1, bend: 2.1, bendUp: 1, grip: P / 2 },
  flexSqueeze: { abduct: 1.4, flex: 0.1, bend: 2.3, bendUp: 1, grip: P / 2 },
  /** A wave, the forearm one way and the other. */
  waveIn: { abduct: 1.85, flex: 0.1, bend: 1.95, bendUp: 1, grip: P / 2 },
  waveOut: { abduct: 1.85, flex: 0.1, bend: 1.4, bendUp: 1, grip: P / 2 },
  /** Thinking: a weight held up by his chin. */
  think: { abduct: 0.3, flex: 0.6, bend: 2.3, bendUp: 0.25, grip: P / 2 },
  /** On the way up to a press: the weight brought in to his chest first, so it never swings wide. */
  tuck: { abduct: 0.2, flex: 0.7, bend: 2.4, bendUp: 0.7, grip: 0 },
  /** The same, the bar already rolled up and down: on the way to a flex or a wave, so it rolls by his chest, never out wide. */
  tuckUpright: { abduct: 0.3, flex: 0.7, bend: 2.2, bendUp: 0.6, grip: P / 2 },
  /** Halfway up a curl, as a fidget. */
  halfCurl: { abduct: 0.15, flex: 0.2, bend: 1.4, bendUp: 0, grip: 0 },
  /** Holding the weights heavy, his arms straight: stuck. */
  sag: { abduct: 0.04, flex: 0.02, bend: 0.04, bendUp: 0, grip: 0 }
} as const satisfies Record<string, ArmPose>

/** His rest: standing, the weights at his sides, his eyes ahead. */
export const REST: RigTarget = REST_TARGET

/**
 * FROM ONE MOVE INTO THE NEXT (a handoff). His face can change mid-lift --
 * thinking while he presses, a finish while he curls -- and a spring alone,
 * pulling each joint straight to the next move's pose, swings his arms out
 * wide and fast (a pressed weight brought down to his side flies out past
 * the picture). So he is first brought to where the next move begins, from
 * wherever he is, each arm along the way a person brings a weight -- through
 * the poses between, from over his head to halfway, to his shoulders, to his
 * chest, to his side -- and the move plays from there.
 */
const LADDER: readonly ArmPose[] = [POSES.rest, POSES.tuck, POSES.rack, POSES.press, POSES.lockout]
/** How long a handoff takes: at least, more by how far his arms go (in radians of their joints), and at most. */
export const HANDOFF_MS = { base: 260, perJoint: 150, most: 900 } as const

const nearestRung = (arm: ArmPose): number => {
  let best = 0
  LADDER.forEach((rung, i) => {
    if (jointGap(arm, rung) < jointGap(arm, LADDER[best] as ArmPose)) best = i
  })
  return best
}

/** The way an arm goes from one pose to another: the rungs between, in order. */
function armWay(from: ArmPose, to: ArmPose): readonly ArmPose[] {
  const a = nearestRung(from)
  const b = nearestRung(to)
  if (a === b) return [from, to]
  const step = b > a ? 1 : -1
  const rungs: ArmPose[] = []
  for (let i = a; i !== b + step; i += step) rungs.push(LADDER[i] as ArmPose)
  return [from, ...rungs, to]
}

/** `k` (0 to 1) of the way along an arm's way, smoothly; its weight rolls evenly the whole way. */
function alongWay(way: readonly ArmPose[], k: number): ArmPose {
  const first = way[0] as ArmPose
  const last = way[way.length - 1] as ArmPose
  return { ...smoothWay(way, k), grip: first.grip + (last.grip - first.grip) * k }
}

/** How far an arm goes on its way, by its joints. */
const wayLength = (way: readonly ArmPose[]): number => way.slice(1).reduce((sum, pose, i) => sum + jointGap(way[i] as ArmPose, pose), 0)

/**
 * How long a handoff from where he is to where a move starts takes, in ms: by
 * how far his arms have to go; none when he is there already.
 */
export function handoffMs(from: RigTarget, start: RigTarget): number {
  const far = Math.max(wayLength(armWay(from.pose.left, start.pose.left)), wayLength(armWay(from.pose.right, start.pose.right)))
  const moved = far + Math.abs(from.pose.dip - start.pose.dip) / 10 + Math.abs(from.look - start.look) / 4
  if (moved < 0.02) return 0
  return Math.min(HANDOFF_MS.most, HANDOFF_MS.base + HANDOFF_MS.perJoint * far)
}

/**
 * Where he is asked to be `k` (0 to 1) of the way through a handoff: from
 * `from`, where he was as the move was asked for, to `start`, where it
 * begins -- each arm along the way a person brings a weight, planned once --
 * and only then does the move play.
 */
export function handoff(from: RigTarget, start: RigTarget, k: number): RigTarget {
  if (k <= 0) return from
  if (k >= 1) return start
  const t = ease(k)
  return {
    pose: {
      left: alongWay(armWay(from.pose.left, start.pose.left), t),
      right: alongWay(armWay(from.pose.right, start.pose.right), t),
      dip: from.pose.dip + (start.pose.dip - from.pose.dip) * t
    },
    look: from.look + (start.look - from.look) * t
  }
}

/** Curls: each up toward his chest, a squeeze at the top, and down slower. */
const curls = (reps: number): readonly Piece[] => {
  const top = both(POSES.curl, 1.2)
  return times([glide(REST, top, 520), hold(top, 160), glide(top, REST, 640), hold(REST, 180)], reps)
}

/** Alternating curls: one arm and then the other. */
const alternating = (reps: number): readonly Piece[] => {
  const left = each(POSES.curl, REST_ARM, 0.8)
  const right = each(REST_ARM, POSES.curl, 0.8)
  return times([glide(REST, left, 500), hold(left, 120), glide(left, REST, 560), glide(REST, right, 500), hold(right, 120), glide(right, REST, 560)], reps)
}

/** Hammer curls: the weights rolled up and down, curled, and rolled back. */
const hammer = (reps: number): readonly Piece[] => {
  const hang = both(POSES.hammerHang)
  const top = both(POSES.hammer, 1)
  return [glide(REST, hang, 320), ...times([glide(hang, top, 520), hold(top, 160), glide(top, hang, 640), hold(hang, 160)], reps), glide(hang, REST, 320)]
}

/** A shoulder press: up to his shoulders, pressed and locked out over his head, back to his shoulders; and down. */
const press = (reps: number): readonly Piece[] => {
  const rack = both(POSES.rack, 2)
  const mid = both(POSES.press, 1.2)
  const lockout = both(POSES.lockout, 0.5)
  const tuck = both(POSES.tuck, 1)
  return [through(REST, tuck, rack, 780), hold(rack, 140), ...times([through(rack, mid, lockout, 620), hold(lockout, 220), through(lockout, mid, rack, 700), hold(rack, 160)], reps), through(rack, tuck, REST, 800)]
}

/** Squats: down with his arms out in front, and up. */
const squats = (reps: number): readonly Piece[] => {
  const bottom = both(POSES.squat, 14)
  return times([glide(REST, bottom, 820), hold(bottom, 140), glide(bottom, REST, 780), hold(REST, 260)], reps)
}

/** A breather between sets: standing, the weights at his sides. */
const BREATHER: readonly Piece[] = [hold(REST, 900)]

/** A workout: each lift, a breather after each, round and round. */
function workout(name: string, lifts: Readonly<Record<string, readonly Piece[]>>): Move {
  const pieces: Piece[] = []
  const sets: number[] = []
  let at = 0
  for (const lift of Object.values(lifts)) {
    sets.push(at)
    for (const piece of [...lift, ...BREATHER]) {
      pieces.push(piece)
      at += piece.ms
    }
  }
  return moveOf(name, pieces, { loops: true, sets, lifts: Object.keys(lifts), still: both(POSES.rack, 2) })
}

/** Working, delegating, answering, as the face you are talking to: every lift he has. */
export const WORKOUT: Move = workout('workout', { press: press(3), curls: curls(3), squats: squats(3), alternating: alternating(2), hammer: hammer(3) })

/**
 * The same, as a face beside a name -- the sidebar, the header -- where a
 * teammate moves less than the one you are talking to (TeammateBot's
 * BotMotionLevel; Colin, 2026-09-23: *"lets tame those two down"*): no squat,
 * so he stays where he stands.
 */
export const WORKOUT_STANDING: Move = workout('workout-standing', { press: press(3), curls: curls(3), alternating: alternating(2), hammer: hammer(3) })

/** The dots' loop and its look about (Bot's glyphMotion), in ms. */
const DOTS_MS = THINKING_CYCLE_S * 1000
const LOOK_MS = LOOK_ABOUT_S * 1000
const BUSY_MS = DOTS_MS - LOOK_MS

/**
 * Thinking: as a bot looks about with its head in thought (Bot's
 * thinkingGlance, the first LOOK_ABOUT_S of each THINKING_CYCLE_S loop of the
 * dots), his eyes look to one side and the other; while the dots bounce he
 * holds a weight up by his chin, then curls the other slowly. Two of the
 * dots' loops, so he keeps time with them.
 */
const lookAbout = (): readonly Piece[] => [
  glide(REST, withLook(REST, -0.8), LOOK_MS * 0.2),
  hold(withLook(REST, -0.8), LOOK_MS * 0.2),
  glide(withLook(REST, -0.8), withLook(REST, 0.8), LOOK_MS * 0.25),
  hold(withLook(REST, 0.8), LOOK_MS * 0.15),
  glide(withLook(REST, 0.8), REST, LOOK_MS * 0.2)
]
const chin = each(REST_ARM, POSES.think, 0.4)
const slowCurl = each(POSES.curl, REST_ARM, 0.6)
export const THINK: Move = moveOf(
  'think',
  [
    ...lookAbout(),
    glide(REST, chin, BUSY_MS * 0.3),
    hold(chin, BUSY_MS * 0.4),
    glide(chin, REST, BUSY_MS * 0.3),
    ...lookAbout(),
    glide(REST, slowCurl, BUSY_MS * 0.4),
    hold(slowCurl, BUSY_MS * 0.2),
    glide(slowCurl, REST, BUSY_MS * 0.4)
  ],
  { loops: true, still: chin }
)

/** Waiting on you: standing by, breathing; a look one way and the other, and a half curl as he waits. */
const breath = (ms: number): Piece => ({ ms, at: (k) => both(REST_ARM, 0.7 * Math.sin(Math.PI * k)) })
const fidget = each(REST_ARM, POSES.halfCurl, 0.3)
const lookLeft = withLook(REST, -0.8)
const lookRight = withLook(REST, 0.8)
export const WAIT: Move = moveOf(
  'wait',
  [
    breath(1800),
    glide(REST, lookLeft, 300),
    hold(lookLeft, 700),
    glide(lookLeft, REST, 300),
    breath(1400),
    glide(REST, fidget, 450),
    hold(fidget, 300),
    glide(fidget, REST, 550),
    glide(REST, lookRight, 300),
    hold(lookRight, 700),
    glide(lookRight, REST, 300)
  ],
  { loops: true, still: REST }
)

/** A message just in, or your pointer on him at rest: a wave with his weight. */
const waveIn = each(REST_ARM, POSES.waveIn)
const waveOut = each(REST_ARM, POSES.waveOut)
const waveTuck = each(REST_ARM, POSES.tuckUpright)
/** His forearm swung one way and the other: one smooth swing (a sine), three times, from and back to his raised hand. */
const WAVE_SWING_MS = 640
const swinging: Piece = { ms: WAVE_SWING_MS * 3, at: (k) => mixTarget(waveIn, waveOut, 0.5 - 0.5 * Math.cos(k * 3 * 2 * P)) }
export const WAVE: Move = moveOf('wave', [through(REST, waveTuck, waveIn, 680), swinging, through(waveIn, waveTuck, REST, 700)], {
  loops: false,
  still: waveIn
})

/** Just finished: a double-biceps flex, a squeeze, and down to rest. */
const flexed = both(POSES.flex, 1)
const squeezed = both(POSES.flexSqueeze, 1.6)
const flexTuck = both(POSES.tuckUpright, 0.5)
export const FLEX: Move = moveOf('flex', [through(REST, flexTuck, flexed, 720), glide(flexed, squeezed, 320), hold(squeezed, 340), glide(squeezed, flexed, 320), hold(flexed, 200), through(flexed, flexTuck, REST, 780)], {
  loops: false,
  still: flexed
})

/**
 * Stuck: a press that will not go up -- from his shoulders, the weights
 * shaking partway, sinking back -- and down to hang heavy, held there until
 * someone helps.
 */
const stuckRack = both(POSES.rack, 2.5)
const stuckPart = mixTarget(stuckRack, both(POSES.press, 2.5), 0.4)
const strain: Piece = {
  ms: 900,
  at: (k) => {
    const shake = 0.035 * Math.sin(k * P * 2 * 6) * Math.sin(P * k)
    const target = mixTarget(stuckRack, stuckPart, ease(Math.min(1, k * 1.6)))
    const pose = target.pose
    return { ...target, pose: { ...pose, left: { ...pose.left, abduct: pose.left.abduct + shake }, right: { ...pose.right, abduct: pose.right.abduct + shake } } }
  }
}
const heavy = both(POSES.sag, 3)
const stuckTuck = both(POSES.tuck, 1.5)
export const STUCK: Move = moveOf('stuck', [through(REST, stuckTuck, stuckRack, 780), strain, glide(stuckPart, stuckRack, 520), through(stuckRack, stuckTuck, heavy, 880)], {
  loops: false,
  holds: true,
  still: heavy
})

/** At rest, or listening: still, the weights at his sides. */
export const RESTING: Move = moveOf('rest', [], { loops: false, still: REST })

const once = (name: string, pieces: readonly Piece[]): Move => moveOf(name, pieces, { loops: false, still: pieces[0]?.at(1) ?? REST })
const held = (name: string, target: RigTarget, ms: number): Move =>
  moveOf(name, [glide(REST, target, 520), hold(target, ms - 1040), glide(target, REST, 520)], { loops: false, still: target })

/** Where his eyes look for a glance at a teammate, or a moment's look: that way, on his screen. */
export const LOOKING: Readonly<Record<'left' | 'right', number>> = { left: -1, right: 1 }

/** A moment's look to one side. */
const LOOK_LEFT: Move = held('look-left', withLook(REST, LOOKING.left), 1800)
const LOOK_RIGHT: Move = held('look-right', withLook(REST, LOOKING.right), 1800)

/**
 * HIS MOMENTS AT REST, a short set of each lift and the moments every face
 * has, in turn (`buddyMoment`). Their eyes are the ones a face shows at rest
 * (faceLife.ts): glad `^ ^` or wide `o o`, `c c` dozing -- never the busy
 * eyes, the stuck face, or the green. Each lasts as long as its set, and a
 * moment more at rest.
 */
const MOMENT_MOVES: Readonly<Record<string, Move>> = {
  curls: once('curls', curls(2)),
  press: once('press', press(2)),
  squats: once('squats', squats(2)),
  alternating: once('alternating', alternating(1)),
  hammer: once('hammer', hammer(2)),
  curious: held('curious', each(REST_ARM, POSES.think, 0.4, 0.5), 2000),
  doze: held('doze', both(REST_ARM, 0.8), 2600)
}

const EYES_GLAD: EyeGlyphs = ['^', '^']
const EYES_WIDE: EyeGlyphs = ['o', 'o']

/** His moments before each is timed to its set. */
const MOMENTS_AT_REST: readonly IdleMoment[] = [
  { name: 'curls', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'press', eyes: EYES_WIDE, seconds: 0 },
  { name: 'look', eyes: EYES_WIDE, glance: { x: 1, y: -0.35 }, seconds: 1.8 },
  { name: 'squats', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'alternating', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'curious', eyes: EYES_WIDE, mood: 'curious', seconds: 0 },
  { name: 'hammer', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'doze', eyes: ['c', 'c'], state: 'sleeping', seconds: 0 }
]

/** His moments, in the order a face of his goes round them from a seeded start: every lift in a round. */
export const BUDDY_MOMENTS: readonly IdleMoment[] = MOMENTS_AT_REST.map((moment) => {
  const move = MOMENT_MOVES[moment.name]
  // A set's moment lasts the set and a breath at rest after it.
  return move === undefined ? moment : { ...moment, seconds: move.ms / 1000 + 0.4 }
})

/** The move each of his moments shows, by its name. */
export function momentMove(name: string): Move | undefined {
  return MOMENT_MOVES[name]
}

/**
 * His `count`th moment at rest (useIdleMoment's `pick`): round all of them in
 * turn, from a start his seed picks, so a few minutes at rest show every lift
 * he has; a look goes to whichever side the seed says.
 */
export function buddyMoment(seed: number, count: number): IdleMoment {
  const start = Math.floor(seeded(seed, 0, 3) * BUDDY_MOMENTS.length)
  const chosen = BUDDY_MOMENTS[(start + count) % BUDDY_MOMENTS.length] ?? BUDDY_MOMENTS[0]
  if (chosen === undefined) return { name: 'doze', eyes: ['c', 'c'], seconds: 2.6 }
  if (chosen.glance === undefined) return chosen
  return { ...chosen, glance: { ...chosen.glance, x: seeded(seed, count, 2) < 0.5 ? -1 : 1 } }
}

/**
 * What he does for what his face is doing (TeammateBot's EverydayFace key):
 * his workout for work -- its standing lifts at the `subtle` level of a face
 * beside a name -- his thinking and his waiting, a wave, a flex when he
 * finishes, a press that fails when he is stuck, and a moment's set at rest.
 * `look` is where a moment's look goes (its glance's x).
 */
export function buddyMoveFor(key: string, look?: number, level: 'full' | 'subtle' = 'full'): Move {
  switch (key) {
    case 'working':
    case 'delegating':
    case 'responding':
      return level === 'subtle' ? WORKOUT_STANDING : WORKOUT
    case 'thinking':
      return THINK
    case 'waiting':
      return WAIT
    case 'receiving':
    case 'idle:noticed':
      return WAVE
    case 'done':
      return FLEX
    case 'blocked':
      return STUCK
    case 'idle:look':
      return (look ?? 1) < 0 ? LOOK_LEFT : LOOK_RIGHT
    // A beat at work (faceLife.ts's WORKING_BEATS): the thinking beat is his thinking; the rest, his lifts go on.
    case 'working:think':
      return THINK
    default:
      if (key.startsWith('working:')) return level === 'subtle' ? WORKOUT_STANDING : WORKOUT
      return key.startsWith('idle:') ? (MOMENT_MOVES[key.slice('idle:'.length)] ?? RESTING) : RESTING
  }
}

/** A pet's routine: what it does for what its face is doing, and how it picks its moments at rest. */
export interface PetRoutine {
  readonly moveFor: (key: string, look?: number, level?: 'full' | 'subtle') => Move
  readonly moment: MomentPick
}

const ROUTINES: Readonly<Record<string, PetRoutine>> = {
  'codex-buddy': { moveFor: buddyMoveFor, moment: buddyMoment }
}

/** The routine of a pet with moves of its own (his, Codex Buddy's); undefined for any other. */
export function routineFor(id: string): PetRoutine | undefined {
  return ROUTINES[id]
}

/** Where his eyes look for a glance at a teammate (glances.ts): that way, or nowhere for up and down. */
export function glanceLook(side: GlanceSide): number | undefined {
  return side === 'left' ? LOOKING.left : side === 'right' ? LOOKING.right : undefined
}

/** Where a move is at a moment: what his rig is asked for, and whether the move is done with (nothing more will change). */
export interface MoveAt {
  readonly target: RigTarget
  readonly settled: boolean
}

/**
 * Where a move begun `from` ms in (a set's start) is `elapsed` ms later. A
 * looping move goes round; one played once ends at rest, or where it ends
 * when it `holds`. Still: the move's still pose.
 */
export function movePoseAt(move: Move, elapsed: number, from = 0, still = false): MoveAt {
  if (still) return { target: move.still, settled: true }
  if (move.ms <= 0) return { target: move.holds === true ? move.still : REST, settled: true }
  const into = Math.max(0, from) + Math.max(0, elapsed)
  if (move.loops) return { target: move.at(into % move.ms), settled: false }
  if (into < move.ms) return { target: move.at(into), settled: false }
  return { target: move.holds === true ? move.at(move.ms) : REST, settled: true }
}
