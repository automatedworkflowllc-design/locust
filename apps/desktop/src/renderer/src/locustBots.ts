/**
 * LOCUST'S OWN BOTS: outlines for the bot-avatars engine.
 *
 * Colin, 2026-09-22, on libraries.dev/bots: *"this is actually fucking
 * perfect brother, this could revamp our design so much ... if we could
 * design our own locust version that would be funny too"*.
 *
 * The library draws any outline through its exported renderer: a body path
 * in its 100-unit box, and thin `parts` (antennae, legs) drawn behind the
 * body at part of its depth. These are only the outlines; the lighting,
 * the rig, the blinking and the hops are the library's own.
 *
 * - Hopper: the jumper, front on. A round body, antennae swept back, and the
 *   thing that says grasshopper at any size -- big hind legs folded up
 *   behind it, the femur a drumstick (an ellipse, not a rod).
 * - Swarm: the mark in flight, seen from above -- four wings and a long body,
 *   the face on the head.
 */

export type LocustBotType = 'hopper' | 'swarm'

export interface LocustBotShape {
  readonly name: string
  /** The outline the eyes live on: the renderer clips the face to it. */
  readonly body: string
  /** Drawn behind the body at `partsDepth` of its depth: antennae, legs, wings. */
  readonly parts: string
  readonly partsDepth: number
  /** How far the head swings while idle, 1 as the library has it. */
  readonly turn: number
  readonly faceX: number
  readonly faceY: number
  readonly faceScale: number
}

const f = (n: number): number => Math.round(n * 100) / 100

/** A rotated ellipse as two clockwise half-arcs, so a union of them stays filled. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number, deg = 0): string {
  const t = (deg * Math.PI) / 180
  const x0 = cx + rx * Math.cos(t)
  const y0 = cy + rx * Math.sin(t)
  const x1 = cx - rx * Math.cos(t)
  const y1 = cy - rx * Math.sin(t)
  return `M${f(x0)} ${f(y0)}A${rx} ${ry} ${deg} 1 1 ${f(x1)} ${f(y1)}A${rx} ${ry} ${deg} 1 1 ${f(x0)} ${f(y0)}Z`
}

/** A rod with round ends from a to b: an antenna, a shin. */
export function rodPath(ax: number, ay: number, bx: number, by: number, r: number): string {
  const length = Math.hypot(bx - ax, by - ay)
  const nx = (-(by - ay) / length) * r
  const ny = ((bx - ax) / length) * r
  return (
    `M${f(ax + nx)} ${f(ay + ny)}L${f(bx + nx)} ${f(by + ny)}` +
    `A${r} ${r} 0 0 0 ${f(bx - nx)} ${f(by - ny)}L${f(ax - nx)} ${f(ay - ny)}` +
    `A${r} ${r} 0 0 0 ${f(ax + nx)} ${f(ay + ny)}Z`
  )
}

/** An ellipse laid along a limb from hip to knee: a thigh. */
function thighPath(ax: number, ay: number, bx: number, by: number, width: number): string {
  const deg = f((Math.atan2(by - ay, bx - ax) * 180) / Math.PI)
  return ellipsePath((ax + bx) / 2, (ay + by) / 2, Math.hypot(bx - ax, by - ay) / 2 + 2, width, deg)
}

/**
 * WINGS AND LEGS ARE PARTS, NOT BODY.
 *
 * The renderer clips the eyes to the body outline, and slides them over a
 * sphere as wide as the whole bot as the head turns (radius 30 of the 100
 * units, up to 36 degrees of idle yaw). With the wings inside the body, a
 * turned head's eye slid off the small head onto a wing -- Colin: *"locust
 * swarms eyes clip onto his legs when he looks around"*. Drawn as parts, the
 * wings sit behind the body and the eyes can only ever draw on head and body;
 * a turned eye goes round the head's edge like any other bot's. Checked pose by
 * pose (yaw to 36, a glance, a spin, a nod) before and after.
 */
const WINGS =
  ellipsePath(27, 44, 25, 8.5, 12) +
  ellipsePath(73, 44, 25, 8.5, -12) +
  ellipsePath(31, 60, 20, 7.5, -12) +
  ellipsePath(69, 60, 20, 7.5, 12)

export const LOCUST_BOTS: Readonly<Record<LocustBotType, LocustBotShape>> = {
  hopper: {
    name: 'Hopper',
    body: ellipsePath(50, 62, 28, 27),
    parts:
      rodPath(43, 38, 31, 7, 2.2) +
      rodPath(57, 38, 69, 7, 2.2) +
      thighPath(33, 74, 13, 37, 6.2) +
      rodPath(13, 37, 16, 91, 2.5) +
      thighPath(67, 74, 87, 37, 6.2) +
      rodPath(87, 37, 84, 91, 2.5),
    partsDepth: 0.5,
    turn: 1,
    faceX: 50,
    faceY: 59,
    faceScale: 0.92
  },
  swarm: {
    name: 'Swarm',
    body: ellipsePath(50, 61, 13, 31) + ellipsePath(50, 31, 18, 15),
    parts: WINGS + rodPath(46, 22, 35, 3, 1.9) + rodPath(54, 22, 65, 3, 1.9),
    partsDepth: 0.55,
    // A small head glances less far, so its eyes stay on it.
    turn: 0.7,
    faceX: 50,
    faceY: 31,
    faceScale: 0.74
  }
}

export function isLocustBot(type: string): type is LocustBotType {
  return type === 'hopper' || type === 'swarm'
}
