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

export type LocustBotType = 'hopper' | 'swarm' | 'critter' | 'prompt' | 'spark'

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
  /** Its face is a dark screen, its eyes lit glyphs on it (Bot.tsx). */
  readonly screen?: boolean
  /** A mark on its chest -- the Codex mascot's prompt, `>_`, or the Claude mascot's asterisk -- where, in the outline's 0 to 100 units, and how big (its height). */
  readonly chest?: ChestMark
}

const f =(n: number): number => Math.round(n * 100) / 100

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

/** A mascot's chest mark: which, where (the outline's units), and how big. */
export interface ChestMark {
  readonly mark: 'prompt' | 'spark'
  readonly x: number
  readonly y: number
  readonly size: number
}

/** A cloud: a round middle and `lobes` round lobes about it, every one clockwise so they fill as one. */
export function cloudPath(cx: number, cy: number, core: number, reach: number, lobe: number, lobes = 8, turn = 0.2): string {
  let path = ellipsePath(cx, cy, core, core)
  for (let i = 0; i < lobes; i += 1) {
    const angle = (i / lobes) * Math.PI * 2 + turn
    path += ellipsePath(f(cx + Math.cos(angle) * reach), f(cy + Math.sin(angle) * reach), lobe, lobe)
  }
  return path
}

/** A rectangle with round corners, clockwise from its top edge, as one filled subpath. */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${r} ${r} 0 0 1 ${f(x + w)} ${f(y + r)}` +
    `V${f(y + h - r)}A${r} ${r} 0 0 1 ${f(x + w - r)} ${f(y + h)}` +
    `H${f(x + r)}A${r} ${r} 0 0 1 ${f(x)} ${f(y + h - r)}` +
    `V${f(y + r)}A${r} ${r} 0 0 1 ${f(x + r)} ${f(y)}Z`
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

/**
 * The outline of rounds laid together, as ONE path: from `centre`, the
 * furthest any round reaches along each of `steps` rays -- the outer edge,
 * with its pinched valleys where two rounds meet. The rig's plastic lights
 * every subpath's own edge, so rounds laid as separate subpaths show their
 * seams inside the shape; one outline has none.
 */
export function unionOutline(centre: readonly [number, number], rounds: readonly (readonly [x: number, y: number, rx: number, ry: number, turn?: number])[], steps = 180): string {
  const [cx, cy] = centre
  const points: string[] = []
  for (let i = 0; i < steps; i += 1) {
    const angle = -Math.PI / 2 + (i / steps) * Math.PI * 2
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    let reach = 0
    for (const [x, y, rx, ry, turn = 0] of rounds) {
      // Where the ray leaves this round (turned `turn` radians): in the round's own frame, solve for t on (ox + t ux)^2 + (oy + t uy)^2 = 1.
      const cos = Math.cos(-turn)
      const sin = Math.sin(-turn)
      const px = cx - x
      const py = cy - y
      const ox = (px * cos - py * sin) / rx
      const oy = (px * sin + py * cos) / ry
      const ux = (dx * cos - dy * sin) / rx
      const uy = (dx * sin + dy * cos) / ry
      const a = ux * ux + uy * uy
      const b = 2 * (ox * ux + oy * uy)
      const c = ox * ox + oy * oy - 1
      const disc = b * b - 4 * a * c
      if (disc < 0) continue
      reach = Math.max(reach, (-b + Math.sqrt(disc)) / (2 * a))
    }
    points.push(`${i === 0 ? 'M' : 'L'}${f(cx + dx * reach)} ${f(cy + dy * reach)}`)
  }
  return `${points.join('')}Z`
}

/**
 * THE CODEX MASCOT'S HEAD (its own renders): a rounded square with four
 * subtle lumps, one at each corner, and a shallow dip between each two --
 * Colin: *"the other one has like 4 subtle lumps in both pics i sent you"*.
 * Never a burst of petals, which is the Claude mascot's. One outline.
 */
const CODEX_HEAD = unionOutline(
  [50, 38],
  [
    // Its four corners, the lumps...
    [37, 28, 14, 13],
    [63, 28, 14, 13],
    [37, 48, 14, 13],
    [63, 48, 14, 13],
    // ...and its middle, filling it out to a square but for a shallow dip mid-side.
    [50, 38, 25.8, 22.4]
  ],
  240
)

/** Its small body and its two stubby legs, one outline under its head. */
const CODEX_BODY = unionOutline(
  [50, 68],
  [
    [50, 66.5, 14.5, 11],
    [50, 71, 13, 9.5],
    [43.5, 80, 5.8, 6.2],
    [56.5, 80, 5.8, 6.2]
  ],
  180
)

/** Its mitts, hanging close at its sides: a hair clear of its body, so neither lies over the other. */
const CODEX_MITTS = ellipsePath(31.4, 67.5, 4.3, 6.8, 12) + ellipsePath(68.6, 67.5, 4.3, 6.8, -12)

/**
 * THE CLAUDE MASCOT'S BODY (github.com/Minecraft-2048/mascotte-claude's own
 * board, and Colin's pixel drawing of it): one shape, a flower -- seven round
 * petals, evenly spaced round its top and its sides -- whose trunk runs down
 * to its legs, its nub arms low on its sides. One outline. Colin: *"make the
 * claude logo better, its not accurate"*.
 */
const CLAUDE_BURST = unionOutline(
  [50, 46],
  [
    [50, 45, 22, 22],
    [50, 60, 17, 15],
    [50, 21, 9.5, 9.5],
    [35.2, 26.4, 9.5, 9.5],
    [64.8, 26.4, 9.5, 9.5],
    [27.3, 40, 9.5, 9.5],
    [72.7, 40, 9.5, 9.5],
    [30.1, 55.5, 9.5, 9.5],
    [69.9, 55.5, 9.5, 9.5],
    [27.5, 67.5, 5.5, 6.5, 0.6],
    [72.5, 67.5, 5.5, 6.5, -0.6]
  ],
  240
)


/**
 * A SHAPE DRAWN LARGER IN ITS BOX (0.663). The two mascots filled about 70 and
 * 74 of the box's 100 units where every other bot fills 85 to 90, so on a card
 * they sat half the size of the teammates beside them (Colin: "his model is
 * like half the size of the others"). Grown about (ox, oy): its outline (M, L,
 * A and Z, the commands this file writes), its screen and its chest mark.
 */
export function grownPath(path: string, k: number, ox: number, oy: number): string {
  const tokens = path.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  const out: string[] = []
  let i = 0
  const num = (): number => Number(tokens[i++])
  const x = (v: number): string => String(f(ox + (v - ox) * k))
  const y = (v: number): string => String(f(oy + (v - oy) * k))
  while (i < tokens.length) {
    const command = tokens[i++]
    if (command === 'M' || command === 'L') {
      out.push(`${command}${x(num())} ${y(num())}`)
    } else if (command === 'A') {
      const rx = num()
      const ry = num()
      const turn = num()
      const large = num()
      const sweep = num()
      out.push(`A${f(rx * k)} ${f(ry * k)} ${turn} ${large} ${sweep} ${x(num())} ${y(num())}`)
    } else if (command === 'Z') {
      out.push('Z')
    } else {
      throw new Error(`grownPath: unexpected ${String(command)}`)
    }
  }
  return out.join('')
}

function grown(shape: LocustBotShape, k: number, ox: number, oy: number): LocustBotShape {
  return {
    ...shape,
    body: grownPath(shape.body, k, ox, oy),
    ...(shape.parts === undefined || shape.parts === '' ? {} : { parts: grownPath(shape.parts, k, ox, oy) }),
    faceX: ox + (shape.faceX - ox) * k,
    faceY: oy + (shape.faceY - oy) * k,
    faceScale: shape.faceScale * k,
    ...(shape.chest === undefined ? {} : { chest: { ...shape.chest, x: ox + (shape.chest.x - ox) * k, y: oy + (shape.chest.y - oy) * k, size: shape.chest.size * k } })
  }
}

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
    parts: WINGS + rodPath(46, 22, 35, 3, 2) + rodPath(54, 22, 65, 3, 2),
    partsDepth: 0.55,
    // A small head glances less far, so its eyes stay on it.
    turn: 0.7,
    faceX: 50,
    faceY: 31,
    faceScale: 0.74
  },
  /*
   * TWO THAT NOD TO THE AGENTS (0.559). Colin, 2026-10-02: "keep the
   * mascots, if its a problem on wider release, we remove, just stylize them
   * like our teammates so its not a 1:1". Neither is Anthropic's or OpenAI's
   * drawing: each is an outline in this file, worn in the teammate's own hue
   * and the rig's plastic like every other bot. Picked only, never derived,
   * so no teammate's face changes, and taking them out later is two entries.
   *
   * - Critter: a wide block with stub arms and four short legs -- the shape a
   *   coding agent's little terminal creature has, in our plastic.
   * - Prompt: a soft terminal window, its three title-bar dots up top, its
   *   face a dark screen with lit eyes (0.560).
   *
   * PROMPT, CLOSER TO THE CODEX MASCOT (2026-10-05). Colin: *"rework our
   * codex teammate to be closer to reality, ours was done a little lazily and
   * in a hurry"*, with the mascot's own sheet: a puffy cloud of a head -- the
   * Codex mark's cloud -- wearing a dark screen for a face, a small body under
   * it with its prompt, `>_`, on its chest, stubby arms and feet. Still in
   * the teammate's own colour and the rig's plastic, like every teammate.
   */
  critter: {
    name: 'Critter',
    body: roundRectPath(15, 30, 70, 44, 13) + roundRectPath(5, 45, 14, 13, 5) + roundRectPath(81, 45, 14, 13, 5),
    parts: rodPath(27, 70, 27, 89, 3.6) + rodPath(41, 70, 41, 89, 3.6) + rodPath(59, 70, 59, 89, 3.6) + rodPath(73, 70, 73, 89, 3.6),
    partsDepth: 0.55,
    turn: 1,
    faceX: 50,
    faceY: 51,
    faceScale: 0.9
  },
  // Grown to fill its box as the other bots fill theirs (0.663): 15..86 tall becomes 6..95.
  prompt: grown({
    name: 'Prompt',
    // Its head: a cumulus -- a wide round head with its bumps along its top and sides, smooth underneath -- and its small body under it.
    // Its mitts and its feet are body too, not parts: so the plush lays its pile on them as on the rest of it.
    // Its head, its body with its legs, and its mitts: each one outline, none lying over another but where its head sits on its body.
    body: CODEX_HEAD + CODEX_BODY + CODEX_MITTS,
    parts: '',
    partsDepth: 0.5,
    turn: 1,
    // Its screen is most of its face, low on its head, as the mascot's is.
    faceX: 50,
    faceY: 41,
    faceScale: 0.76,
    // Colin, 2026-10-03, of the codex mascot: "he also seems to have a screen for a face".
    screen: true,
    chest: { mark: 'prompt', x: 50, y: 67.5, size: 11 }
  }, 1.26, 50, 50.5),
  /*
   * SPARK, THE CLAUDE MASCOT (2026-10-05). Colin: *"i want you to add this so
   * we can show some love to claude as well ... and obviously swap in our
   * terminal face"*, of github.com/Minecraft-2048/mascotte-claude, and *"the
   * claude code mascot could be a nod to the other side"*. Measured from its
   * own board, as Prompt was from the Codex mascot's: its starburst of a body,
   * its screen in the middle of it, the asterisk on its chest under the screen,
   * its little arms and its stubby legs -- all body, so the Plush furs them.
   */
  // Grown to fill its box (0.663): 11.5..85 tall becomes 3..93.
  spark: grown({
    name: 'Spark',
    body: CLAUDE_BURST + ellipsePath(42.5, 79, 5.4, 6.2) + ellipsePath(57.5, 79, 5.4, 6.2),
    parts: '',
    partsDepth: 0.5,
    turn: 1,
    // Its screen: about two fifths of it across, in its middle.
    faceX: 50,
    faceY: 43,
    faceScale: 0.7,
    screen: true,
    chest: { mark: 'spark', x: 50, y: 66, size: 18 }
  }, 1.22, 50, 48.3)
}

export function isLocustBot(type: string): type is LocustBotType {
  return type === 'hopper' || type === 'swarm' || type === 'critter' || type === 'prompt' || type === 'spark'
}
