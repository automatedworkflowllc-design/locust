/**
 * CODEX BUDDY ON A RIG OF HIS OWN (2026-10-05).
 *
 * Colin, of his lifts drawn by his maker in three to five drawings each:
 * *"youre relying too much on trying to smooth the old animation im saying you
 * should have the tools to make your own"*, then *"make sure its not janky,
 * and production quality"*. So his arms are no longer drawings. His body is
 * his maker's standing drawing with its arms and dumbbells taken off (the
 * PLATE, cut from his sheet as it is read: `buddyPlate`); his arms, fists and
 * dumbbells are drawn here, in his style -- his ink round his skin, a shaded
 * strip down the outer side, chunky grey plates -- on joints in 3D: a
 * shoulder that raises the arm out to the side and toward you, an elbow that
 * bends the forearm toward you (a curl) or up (a press). A part nearer you is
 * drawn a little larger, so a curl comes toward you.
 *
 * Every joint moves on a spring, as a bot's body does (bot-avatars'
 * physics): a lift accelerates, overshoots a touch and settles, and a change
 * of lift is never a jump. Drawn fresh every frame of a bot's clock, he moves
 * as smoothly as the bots do. Units: his drawing's pixels (192 x 208), y
 * down, z toward you.
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
  readonly left: ArmPose
  readonly right: ArmPose
  /** How far his body dips, pixels down (a squat, or the effort of a rep). */
  readonly dip: number
}

/** The arm keys a spring moves, in order. */
export const ARM_KEYS = ['abduct', 'flex', 'bend', 'bendUp', 'grip'] as const

export const BUDDY_RIG = {
  /** His drawing his body is cut from: standing, a dumbbell at each side. */
  plate: { row: 8, column: 0 },
  /** Where each arm hangs from: under its sleeve, at the shoulder. */
  shoulder: { left: { x: 63.5, y: 100 }, right: { x: 130, y: 100 } },
  upper: 24,
  fore: 22,
  /** The arm's skin across, and his ink round it. */
  width: 15,
  ink: 3,
  /** His dumbbells and fists, as large as his own are drawn. */
  gear: 1,
  fist: 1.25,
  skin: '#f2bd8f',
  shade: '#d9a273',
  inkColour: '#0c080d',
  plateColour: '#57575d',
  plateLight: '#9a9aa2',
  bar: '#3c3c42',
  /** His shirt's white, and the Codex mark on it (drawCodexMark): its middle and its size, and its colour, the Codex blue. */
  shirt: '#fefefe',
  shirtMark: { x: 93, y: 106, radius: 12 },
  markColour: '#3047d9',
  /** His maker's own mark, taken off his shirt as his body is cut. */
  makersMark: { left: 77, top: 90, right: 109, bottom: 117 },
  /** His feet: a squat keeps them where they are. */
  feet: 200,
  /** Where his legs start: below this a squat shortens them. */
  hips: 158,
  /** The sleeves' rows, drawn again over the arms so each arm comes out from under its sleeve. */
  sleeves: { from: 80, to: 101, left: [52, 71], right: [114, 142] }
} as const

/** A dumbbell's bar from end to end and its inner plates' height, before `gear` and nearness. */
export const DUMBBELL = { halfLength: 21.25, halfHeight: 11 } as const

export const REST_ARM: ArmPose = { abduct: 0.06, flex: 0.04, bend: 0.12, bendUp: 0, grip: 0 }
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

/** Where an arm's elbow and hand are, in 3D, for its pose: `side` -1 his right (the picture's left), 1 his left. */
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

/** Nearer, larger: a part toward you by `z` pixels is drawn this much bigger. */
export function nearness(z: number): number {
  return 1 + Math.max(-0.1, Math.min(0.25, z * 0.006))
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

function stroke(context: CanvasRenderingContext2D, from: Vec3, to: Vec3, width: number, colour: string): void {
  context.beginPath()
  context.moveTo(from.x, from.y)
  context.lineTo(to.x, to.y)
  context.lineCap = 'round'
  context.lineWidth = width
  context.strokeStyle = colour
  context.stroke()
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + w, y, x + w, y + h, r)
  context.arcTo(x + w, y + h, x, y + h, r)
  context.arcTo(x, y + h, x, y, r)
  context.arcTo(x, y, x + w, y, r)
  context.closePath()
}

/** A dumbbell held at `at`, its bar rolled by `grip` (radians in the picture), `scale` nearer or farther. */
function drawDumbbell(context: CanvasRenderingContext2D, at: Vec3, grip: number, scale: number): void {
  const R = BUDDY_RIG
  context.save()
  context.translate(at.x, at.y)
  context.rotate(grip)
  context.scale(scale * R.gear, scale * R.gear)
  const ink = R.ink / R.gear
  context.lineJoin = 'round'
  const part = (x: number, w: number, h: number, r: number, fill: string): void => {
    roundRect(context, x - w / 2, -h / 2, w, h, r)
    context.fillStyle = fill
    context.fill()
    context.lineWidth = ink
    context.strokeStyle = R.inkColour
    context.stroke()
  }
  // The bar, then two plates each end: the inner the larger, each with a lit edge.
  part(0, 40, 5, 2.5, R.bar)
  for (const end of [-1, 1]) {
    part(end * 12.5, 6.5, 22, 2.5, R.plateColour)
    part(end * 18.5, 5.5, 17, 2.2, R.plateColour)
  }
  context.beginPath()
  for (const end of [-1, 1]) {
    context.moveTo(end * 12.5 - 1.2, -8)
    context.lineTo(end * 12.5 - 1.2, 8)
    context.moveTo(end * 18.5 - 1, -5.5)
    context.lineTo(end * 18.5 - 1, 5.5)
  }
  context.lineWidth = 1.4
  context.strokeStyle = R.plateLight
  context.stroke()
  context.restore()
}

function drawFist(context: CanvasRenderingContext2D, at: Vec3, grip: number, scale: number): void {
  const R = BUDDY_RIG
  context.save()
  context.translate(at.x, at.y)
  context.rotate(grip)
  context.scale(scale * R.fist, scale * R.fist)
  roundRect(context, -6.2, -6.5, 12.4, 13, 5)
  context.fillStyle = R.skin
  context.fill()
  context.lineWidth = R.ink / R.fist
  context.strokeStyle = R.inkColour
  context.stroke()
  // His knuckles: three short creases.
  context.beginPath()
  for (const y of [-2.6, 0, 2.6]) {
    context.moveTo(1.5, y)
    context.lineTo(4.2, y)
  }
  context.lineWidth = 1.1
  context.stroke()
  context.restore()
}

/**
 * His body in `pose`, at the context's transform (his drawing's pixels): the
 * plate, above his hips lowered by the dip and his legs below shortened to
 * keep his feet where they stand.
 */
export function drawBuddyBody(context: CanvasRenderingContext2D, plate: CanvasImageSource, pose: BuddyPose): void {
  const R = BUDDY_RIG
  const dip = pose.dip
  const legs = R.feet - R.hips
  context.drawImage(plate, 0, 0, 192, R.hips, 0, dip, 192, R.hips)
  context.drawImage(plate, 0, R.hips, 192, 208 - R.hips, 0, R.hips + dip, 192, (208 - R.hips) * ((legs - dip) / legs))
  drawCodexMark(context, R.shirtMark.x, R.shirtMark.y + dip, R.shirtMark.radius)
}

/**
 * THE CODEX MARK ON HIS SHIRT (2026-10-05). Colin: *"you should just give his
 * shirt the codex logo lol ... that way we can keep the nod to codex while
 * having familiarity"*. His maker drew a mark of their own there (taken off
 * as his body is cut: cleanPlate); in its place, drawn here so it stays crisp
 * at any size: the Codex cloud, eight lobes round, and its prompt, `>_`.
 * `radius` is the cloud's, to the outside of its outline.
 */
export function drawCodexMark(context: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const R = BUDDY_RIG
  const line = radius * 0.17
  // The cloud: its lobes round a middle, drawn as one shape twice -- his colour, then the shirt inset by the line.
  const cloud = (grow: number): void => {
    context.beginPath()
    const reach = radius * 0.5
    const lobe = radius * 0.5 - line / 2 + grow
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2 + 0.2
      const cx = x + Math.cos(angle) * reach
      const cy = y + Math.sin(angle) * reach
      context.moveTo(cx + lobe, cy)
      context.arc(cx, cy, lobe, 0, Math.PI * 2)
    }
    context.moveTo(x + reach + grow, y)
    context.arc(x, y, reach + grow, 0, Math.PI * 2)
  }
  context.save()
  cloud(line / 2)
  context.fillStyle = R.markColour
  context.fill('nonzero')
  cloud(-line / 2)
  context.fillStyle = R.shirt
  context.fill('nonzero')
  // The prompt: a chevron and an underscore, round-ended.
  context.beginPath()
  context.moveTo(x - radius * 0.4, y - radius * 0.27)
  context.lineTo(x - radius * 0.19, y)
  context.lineTo(x - radius * 0.4, y + radius * 0.27)
  context.moveTo(x + radius * 0.08, y + radius * 0.25)
  context.lineTo(x + radius * 0.4, y + radius * 0.25)
  context.lineWidth = line
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = R.markColour
  context.stroke()
  context.restore()
}

/**
 * His arms in `pose`, over his body and his face: each arm whole -- its ink
 * under both segments, then its skin over both, so the elbow has no seam --
 * with its shaded strip; the sleeves again over their tops; then the
 * dumbbells and fists, the farther first.
 */
export function drawBuddyArms(context: CanvasRenderingContext2D, plate: CanvasImageSource, pose: BuddyPose): void {
  const R = BUDDY_RIG
  const arms = ([-1, 1] as const).map((side) => {
    const own = side < 0 ? pose.left : pose.right
    return { side, pose: own, ...armJoints(own, side, pose.dip) }
  })
  for (const arm of arms) {
    const near = nearness(arm.hand.z) * 0.94
    stroke(context, arm.shoulder, arm.elbow, R.width + 2 * R.ink, R.inkColour)
    stroke(context, arm.elbow, arm.hand, (R.width + 2 * R.ink) * near, R.inkColour)
    stroke(context, arm.shoulder, arm.elbow, R.width, R.skin)
    stroke(context, arm.elbow, arm.hand, R.width * near, R.skin)
    const shift = R.width * 0.3 * arm.side
    const off = (v: Vec3): Vec3 => ({ x: v.x + shift, y: v.y, z: v.z })
    stroke(context, off(arm.shoulder), off(arm.elbow), R.width * 0.32, R.shade)
    stroke(context, off(arm.elbow), off(arm.hand), R.width * 0.3 * near, R.shade)
  }
  const sleeves = R.sleeves
  const rows = sleeves.to - sleeves.from
  for (const [x0, x1] of [sleeves.left, sleeves.right]) {
    context.drawImage(plate, x0, sleeves.from, x1 - x0, rows, x0, sleeves.from + pose.dip, x1 - x0, rows)
  }
  for (const arm of [...arms].sort((a, b) => a.hand.z - b.hand.z)) {
    const near = nearness(arm.hand.z)
    drawDumbbell(context, arm.hand, arm.pose.grip, near)
    drawFist(context, arm.hand, arm.pose.grip, near)
  }
}

/**
 * HIS BODY, CUT FROM HIS DRAWING (row 8, column 0: standing, a dumbbell at
 * each side), measured 2026-10-05: row by row along his own outline -- his
 * shirt from x 70 to 116, his shorts from 67 to 127, his legs from 66 to 127
 * -- the arms' skin left under his sleeves taken out, and the right of his
 * shorts, hidden behind his fist and dumbbell, made as the mirror of their
 * left (about x 97, their middle); and his maker's mark off his shirt, for
 * the Codex mark drawn there (drawCodexMark). `pixels` is the drawing's RGBA,
 * 192 wide; changed in place.
 */
export function cleanPlate(pixels: Uint8ClampedArray, width = 192): Uint8ClampedArray {
  const source = pixels.slice()
  const at = (x: number, y: number): number => (y * width + x) * 4
  const clear = (x: number, y: number): void => {
    pixels[at(x, y) + 3] = 0
  }
  for (let y = 130; y < 163; y += 1) {
    for (let x = 106; x < 129; x += 1) {
      const to = at(x, y)
      const from = at(194 - x, y)
      for (let k = 0; k < 4; k += 1) pixels[to + k] = source[from + k] ?? 0
    }
  }
  const spans: readonly (readonly [from: number, to: number, left: number, right: number])[] = [
    [101, 130, 70, 116],
    [130, 159, 67, 127],
    [159, 170, 66, 127]
  ]
  for (const [from, to, left, right] of spans) {
    for (let y = from; y < to; y += 1) {
      for (let x = 0; x < width; x += 1) if (x < left || x > right) clear(x, y)
    }
  }
  // His maker's mark off his shirt: the shirt's white where it was.
  const mark = BUDDY_RIG.makersMark
  for (let y = mark.top; y < mark.bottom; y += 1) {
    for (let x = mark.left; x < mark.right; x += 1) pixels.set([254, 254, 254, 255], at(x, y))
  }
  for (let y = 94; y < 101; y += 1) {
    for (let x = 40; x < 150; x += 1) {
      if (x >= 70 && x < 117) continue
      const i = at(x, y)
      const r = source[i] ?? 0
      const g = source[i + 1] ?? 0
      const b = source[i + 2] ?? 0
      const a = source[i + 3] ?? 0
      const skin = a > 128 && r > 150 && r - b > 60 && g > 110 && r - g > 25 && r - g < 75
      if (skin) clear(x, y)
    }
  }
  return pixels
}

const PLATES = new WeakMap<object, CanvasImageSource | 'none'>()

/** His body plate, cut once from a sheet and kept for every face wearing it; undefined where the sheet cannot be read. */
export function buddyPlate(sheet: CanvasImageSource, frameWidth: number, frameHeight: number): CanvasImageSource | undefined {
  const known = PLATES.get(sheet)
  if (known !== undefined) return known === 'none' ? undefined : known
  let made: CanvasImageSource | undefined
  try {
    const canvas = document.createElement('canvas')
    canvas.width = frameWidth
    canvas.height = frameHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context !== null) {
      const { row, column } = BUDDY_RIG.plate
      context.drawImage(sheet, column * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight)
      const image = context.getImageData(0, 0, frameWidth, frameHeight)
      cleanPlate(image.data, frameWidth)
      context.putImageData(image, 0, 0)
      made = canvas
    }
  } catch {
    made = undefined
  }
  PLATES.set(sheet, made ?? 'none')
  return made
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
  step(target: number, dt: number): number {
    this.velocity += (this.stiffness * (target - this.value) - this.damping * this.velocity) * dt
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

/** What his rig is asked for: a pose, and where his eyes look on the glass (-1 his right, 1 his left). */
export interface RigTarget {
  readonly pose: BuddyPose
  readonly look: number
}

export const REST_TARGET: RigTarget = { pose: REST_POSE, look: 0 }

/** His pose and his eyes' look on springs, each following its target. */
export class BuddyRigSim {
  private readonly arms: Readonly<Record<'left' | 'right', Readonly<Record<(typeof ARM_KEYS)[number], Spring>>>>
  private readonly dip: Spring
  private readonly look: Spring
  /** The target the last frame asked for: a frame's steps go from it to the new one, so a coarse clock moves him as a fine one does. */
  private last: RigTarget
  constructor(start: RigTarget = REST_TARGET) {
    this.last = start
    const arm = (pose: ArmPose): Record<(typeof ARM_KEYS)[number], Spring> => ({
      abduct: new Spring(pose.abduct),
      flex: new Spring(pose.flex),
      bend: new Spring(pose.bend),
      bendUp: new Spring(pose.bendUp),
      grip: new Spring(pose.grip)
    })
    this.arms = { left: arm(start.pose.left), right: arm(start.pose.right) }
    this.dip = new Spring(start.pose.dip, 120, 14)
    this.look = new Spring(start.look, 140, 20)
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
    }
    this.last = target
    return this.now()
  }
  /** Straight to `target`, at rest there: a still face. */
  place(target: RigTarget): RigTarget {
    this.last = target
    for (const side of ['left', 'right'] as const) for (const key of ARM_KEYS) this.arms[side][key].place(target.pose[side][key])
    this.dip.place(target.pose.dip)
    this.look.place(target.look)
    return this.now()
  }
  /** Every spring at its target and stopped. */
  restsAt(target: RigTarget): boolean {
    for (const side of ['left', 'right'] as const) for (const key of ARM_KEYS) if (!this.arms[side][key].restsAt(target.pose[side][key])) return false
    return this.dip.restsAt(target.pose.dip) && this.look.restsAt(target.look)
  }
  now(): RigTarget {
    const arm = (side: 'left' | 'right'): ArmPose => {
      const one = this.arms[side]
      return { abduct: one.abduct.value, flex: one.flex.value, bend: one.bend.value, bendUp: one.bendUp.value, grip: one.grip.value }
    }
    return { pose: { left: arm('left'), right: arm('right'), dip: this.dip.value }, look: this.look.value }
  }
}
