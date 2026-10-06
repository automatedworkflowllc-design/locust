/**
 * CODEX BUDDY ON A RIG OF HIS OWN (2026-10-05): his joints and his physics.
 *
 * Colin, of his lifts drawn by his maker in three to five drawings each:
 * *"youre relying too much on trying to smooth the old animation im saying you
 * should have the tools to make your own"*, then *"make sure its not janky,
 * and production quality"*. So below his head he is Locust's own drawing
 * (buddyBody.ts), on joints in 3D: shoulders that raise each arm out to the
 * side and toward you, elbows that bend the forearm toward you (a curl) or up
 * (a press), hips and knees that bend as he squats with his feet where they
 * stand. A part nearer you is drawn a little larger, so a curl comes toward
 * you.
 *
 * Every joint moves on a spring, as a bot's body does (bot-avatars'
 * physics): a lift accelerates, overshoots a touch and settles, and a change
 * of lift is never a jump; and each dumbbell hangs in his hand with a swing
 * of its own, so a weight moved quickly sways and settles. Drawn fresh every
 * frame of a bot's clock, he moves as smoothly as the bots do. Units: his
 * drawing's pixels (192 x 208), y down, z toward you.
 */

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** One arm's pose: how far it is raised to the side and to the front, how far the elbow bends and toward where, and the dumbbell's roll. */
export interface ArmPose {
  /** Raised out to the side, radians: 0 hanging, PI/2 straight out. */
  readonly abduct: number
  /** Raised to the front, toward you, radians. */
  readonly flex: number
  /** The elbow's bend, radians: 0 straight. */
  readonly bend: number
  /** Which way the elbow bends the forearm: toward you (a curl) or up (a press), a blend between. 0 toward you, 1 up. */
  readonly bendUp: number
  /** The dumbbell's roll in the picture: 0 its bar across, PI/2 its bar up and down (a hammer grip). */
  readonly grip: number
}

export interface BuddyPose {
  /** The arm on the picture's left, and on its right. */
  readonly left: ArmPose
  readonly right: ArmPose
  /** How far his hips drop, pixels: a squat, or the effort of a rep. His feet stay where they stand. */
  readonly dip: number
}

/** The arm keys a spring moves, in order. */
export const ARM_KEYS = ['abduct', 'flex', 'bend', 'bendUp', 'grip'] as const

export const BUDDY_RIG = {
  /** The drawing his head is cut from: standing, facing you. */
  plate: { row: 8, column: 0 },
  /** The middle of his body, across. */
  middle: 93.5,
  /** Where each arm turns: inside its sleeve, at the shoulder. */
  shoulder: { left: { x: 62, y: 92 }, right: { x: 125, y: 92 } },
  upper: 28,
  fore: 26,
  /** Where each leg turns, at the hip, and where each ankle stands, pinned: a squat bends the knees between. */
  hip: { left: { x: 81, y: 146 }, right: { x: 106, y: 146 } },
  ankle: { left: { x: 78, y: 186 }, right: { x: 109, y: 186 } },
  thigh: 21,
  shin: 21,
  /** His ink round everything, as wide as his maker's lines. */
  ink: 3,
  /** His dumbbells and fists, as large as his own are drawn. */
  gear: 0.86,
  fist: 1.25,
  skin: '#f2bd8f',
  shade: '#d9a273',
  inkColour: '#0c080d',
  plateColour: '#57575d',
  plateLight: '#9a9aa2',
  bar: '#3c3c42',
  shirt: '#fefefe',
  shirtShade: '#e6e6ea',
  shorts: '#f27d1c',
  star: '#ffd98e',
  shoe: '#1a161b',
  sole: '#8f8f97',
  /** The Codex mark on his shirt (buddyBody's drawCodexMark): its middle, its size, its colour. */
  shirtMark: { x: 93.5, y: 109, radius: 14.5 },
  markColour: '#0c080d',
  /** The ground his shoes stand on. */
  feet: 200
} as const

/** A dumbbell's bar from end to end and its inner plates' height, before `gear` and nearness. */
export const DUMBBELL = { halfLength: 21.25, halfHeight: 11 } as const

export const REST_ARM: ArmPose = { abduct: 0.1, flex: 0.04, bend: 0.14, bendUp: 0, grip: 0 }
export const REST_POSE: BuddyPose = { left: REST_ARM, right: REST_ARM, dip: 0 }

const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

export interface ArmJoints {
  readonly shoulder: Vec3
  readonly elbow: Vec3
  readonly hand: Vec3
}

/** Where an arm's shoulder, elbow and hand are, in 3D, for its pose: `side` -1 the picture's left, 1 its right. */
export function armJoints(pose: ArmPose, side: -1 | 1, dip: number): ArmJoints {
  const at = side < 0 ? BUDDY_RIG.shoulder.left : BUDDY_RIG.shoulder.right
  const s = { x: at.x, y: at.y + dip, z: 0 }
  // The upper arm: down, swung out by `abduct`, then raised toward you by `flex`.
  const outX = side * Math.sin(pose.abduct)
  const outY = Math.cos(pose.abduct)
  const u = norm({ x: outX, y: outY * Math.cos(pose.flex), z: Math.abs(outY) * Math.sin(pose.flex) })
  const elbow = { x: s.x + u.x * BUDDY_RIG.upper, y: s.y + u.y * BUDDY_RIG.upper, z: u.z * BUDDY_RIG.upper }
  // The forearm bends from the upper arm toward its direction: you (0, 0, 1) or up (0, -1, 0).
  const toward = norm({ x: 0, y: -pose.bendUp, z: 1 - pose.bendUp })
  const along = toward.x * u.x + toward.y * u.y + toward.z * u.z
  let perp = { x: toward.x - along * u.x, y: toward.y - along * u.y, z: toward.z - along * u.z }
  if (Math.hypot(perp.x, perp.y, perp.z) < 1e-4) perp = { x: 0, y: 0, z: 1 }
  const p = norm(perp)
  const c = Math.cos(pose.bend)
  const n = Math.sin(pose.bend)
  const f = { x: c * u.x + n * p.x, y: c * u.y + n * p.y, z: c * u.z + n * p.z }
  const hand = { x: elbow.x + f.x * BUDDY_RIG.fore, y: elbow.y + f.y * BUDDY_RIG.fore, z: elbow.z + f.z * BUDDY_RIG.fore }
  return { shoulder: s, elbow, hand }
}

export interface LegJoints {
  readonly hip: Vec3
  readonly knee: Vec3
  readonly ankle: Vec3
}

/**
 * Where a leg's hip, knee and ankle are for his hips dropped `dip`: the ankle
 * pinned where he stands, the knee wherever thigh and shin meet between --
 * out over his toes and toward you, as a squat's knees go.
 */
export function legJoints(side: -1 | 1, dip: number): LegJoints {
  const R = BUDDY_RIG
  const h = side < 0 ? R.hip.left : R.hip.right
  const a = side < 0 ? R.ankle.left : R.ankle.right
  const hip = { x: h.x, y: h.y + dip, z: 0 }
  const ankle = { x: a.x, y: a.y, z: 0 }
  const span = Math.hypot(ankle.x - hip.x, ankle.y - hip.y)
  const reach = Math.min(span / 2, R.thigh - 1e-6)
  const out = Math.sqrt(Math.max(0, R.thigh * R.thigh - reach * reach))
  const middle = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 }
  // Out over his toes, as a squat's knees go, and toward you.
  const bow = norm({ x: side * 1, y: 0, z: 0.75 })
  return { hip, knee: { x: middle.x + bow.x * out, y: middle.y, z: bow.z * out }, ankle }
}

/** Nearer, larger: a part toward you by `z` pixels is drawn this much bigger. */
export function nearness(z: number): number {
  return 1 + Math.max(-0.08, Math.min(0.16, z * 0.0045))
}

/** How far a dumbbell held in `pose` reaches across and up and down from its hand: for keeping it in the picture. */
export function dumbbellReach(pose: ArmPose, joints: ArmJoints): { readonly x: number; readonly y: number } {
  const scale = BUDDY_RIG.gear * nearness(joints.hand.z)
  const length = (DUMBBELL.halfLength + BUDDY_RIG.ink / 2) * scale
  const height = (DUMBBELL.halfHeight + BUDDY_RIG.ink / 2) * scale
  const c = Math.abs(Math.cos(pose.grip))
  const s = Math.abs(Math.sin(pose.grip))
  return { x: c * length + s * height, y: s * length + c * height }
}

/** A spring toward a target, as a bot's body has: damped a little under critical, so it overshoots a touch and settles. */
export class Spring {
  value: number
  velocity = 0
  constructor(
    value: number,
    readonly stiffness = 180,
    readonly damping = 19
  ) {
    this.value = value
  }
  /** One step toward `target`, with `push` added to its acceleration (a weight swung by the hand). */
  step(target: number, dt: number, push = 0): number {
    this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity + push) * dt
    this.value += this.velocity * dt
    return this.value
  }
  /** Where it is is where it is going, and it has stopped. */
  restsAt(target: number): boolean {
    return Math.abs(target - this.value) < 0.002 && Math.abs(this.velocity) < 0.01
  }
  place(value: number): void {
    this.value = value
    this.velocity = 0
  }
}

/** Each spring is stepped at most this long at a time, whatever the clock's frame: the same motion at 30 or 60 frames a second. */
export const RIG_STEP_S = 1 / 120
/** A frame longer than this (his clock stopped and started again) moves him no further than this would. */
export const RIG_LONGEST_FRAME_S = 0.1
/**
 * A dumbbell's own swing in his hand: a loose pendulum (its stiffness and
 * damping), pushed the other way as his hand speeds up or slows across the
 * picture -- this many radians of lean, held, per pixel a second squared.
 */
export const WEIGHT_SWING = { stiffness: 70, damping: 7.5, push: 0.00012 } as const

/** What his rig is asked for: a pose, and where his eyes look on the glass (-1 the picture's left, 1 its right). */
export interface RigTarget {
  readonly pose: BuddyPose
  readonly look: number
}

export const REST_TARGET: RigTarget = { pose: REST_POSE, look: 0 }

type ArmSprings = Readonly<Record<(typeof ARM_KEYS)[number], Spring>>

/** His pose and his eyes' look on springs, each following its target, and each weight's swing. */
export class BuddyRigSim {
  private readonly arms: Readonly<Record<'left' | 'right', ArmSprings>>
  private readonly swings: Readonly<Record<'left' | 'right', Spring>>
  private readonly dip: Spring
  private readonly look: Spring
  /** The target the last frame asked for: a frame's steps go from it to the new one, so a coarse clock moves him as a fine one does. */
  private last: RigTarget
  /** Each hand's place across the picture at the last two steps, for its acceleration. */
  private hands: Record<'left' | 'right', { x0: number; x1: number; dt: number } | undefined> = { left: undefined, right: undefined }
  constructor(start: RigTarget = REST_TARGET) {
    this.last = start
    const arm = (pose: ArmPose): ArmSprings => ({
      abduct: new Spring(pose.abduct),
      flex: new Spring(pose.flex),
      bend: new Spring(pose.bend),
      bendUp: new Spring(pose.bendUp),
      grip: new Spring(pose.grip)
    })
    this.arms = { left: arm(start.pose.left), right: arm(start.pose.right) }
    this.swings = { left: new Spring(0, WEIGHT_SWING.stiffness, WEIGHT_SWING.damping), right: new Spring(0, WEIGHT_SWING.stiffness, WEIGHT_SWING.damping) }
    this.dip = new Spring(start.pose.dip, 120, 14)
    this.look = new Spring(start.look, 140, 20)
  }
  private armNow(side: 'left' | 'right'): ArmPose {
    const one = this.arms[side]
    return { abduct: one.abduct.value, flex: one.flex.value, bend: one.bend.value, bendUp: one.bendUp.value, grip: one.grip.value }
  }
  /** Moves toward `target` over `seconds`, in steps of RIG_STEP_S, the target itself moving from the last frame's to this one's. */
  step(target: RigTarget, seconds: number): RigTarget {
    const span = Math.min(RIG_LONGEST_FRAME_S, Math.max(0, seconds))
    const steps = Math.max(1, Math.ceil(span / RIG_STEP_S - 1e-9))
    const dt = span / steps
    const from = this.last
    const between = (a: number, b: number, k: number): number => a + (b - a) * k
    for (let i = 1; i <= steps && dt > 0; i += 1) {
      const k = i / steps
      for (const side of ['left', 'right'] as const) for (const key of ARM_KEYS) this.arms[side][key].step(between(from.pose[side][key], target.pose[side][key], k), dt)
      this.dip.step(between(from.pose.dip, target.pose.dip, k), dt)
      this.look.step(between(from.look, target.look, k), dt)
      // Each weight swings against its hand's acceleration across the picture.
      for (const side of ['left', 'right'] as const) {
        const x = armJoints(this.armNow(side), side === 'left' ? -1 : 1, this.dip.value).hand.x
        const seen = this.hands[side]
        const accel = seen === undefined ? 0 : (x - 2 * seen.x1 + seen.x0) / (dt * dt)
        this.hands[side] = { x0: seen?.x1 ?? x, x1: x, dt }
        this.swings[side].step(0, dt, -WEIGHT_SWING.push * accel * WEIGHT_SWING.stiffness)
      }
    }
    this.last = target
    return this.now()
  }
  /** Straight to `target`, at rest there: a still face. */
  place(target: RigTarget): RigTarget {
    this.last = target
    for (const side of ['left', 'right'] as const) {
      for (const key of ARM_KEYS) this.arms[side][key].place(target.pose[side][key])
      this.swings[side].place(0)
      this.hands[side] = undefined
    }
    this.dip.place(target.pose.dip)
    this.look.place(target.look)
    return this.now()
  }
  /** Every spring at its target and stopped, and the weights hanging still. */
  restsAt(target: RigTarget): boolean {
    for (const side of ['left', 'right'] as const) {
      for (const key of ARM_KEYS) if (!this.arms[side][key].restsAt(target.pose[side][key])) return false
      if (!this.swings[side].restsAt(0)) return false
    }
    return this.dip.restsAt(target.pose.dip) && this.look.restsAt(target.look)
  }
  /** His pose as drawn: each weight's roll with its swing. */
  now(): RigTarget {
    const arm = (side: 'left' | 'right'): ArmPose => {
      const pose = this.armNow(side)
      return { ...pose, grip: pose.grip + this.swings[side].value }
    }
    return { pose: { left: arm('left'), right: arm('right'), dip: this.dip.value }, look: this.look.value }
  }
}
