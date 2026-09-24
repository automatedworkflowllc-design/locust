/**
 * WHERE A BOT'S WAITING RING AND PRESENCE DOT GO: on the bot, not its box.
 *
 * Colin, 2026-09-23, with a frame of the home screen's machine: "looks like
 * the online dots are off a bit, the square for the blue guy is off a bit".
 * A bot is drawn on a canvas larger than its box and lifted within it, and
 * each shape fills that canvas differently -- while the ring was inset 6% of
 * the box and the dot sat 6% from its lower right. Measured on 0.304
 * (probe-bot-anchors, a 76 px cover bot): the droid's ring 24 px above the
 * droid's middle, the ghost's dot 33 px above the ghost's lower edge.
 *
 * So both are placed from the BODY: where the canvas actually has paint, read
 * once per shape and state (cache in Bot.tsx) as fractions of the bot's size,
 * so the same numbers hold at 26 px in the sidebar and 76 px on the cover.
 */

/** Where the paint is, as fractions of the bot's size, from its box's top-left. */
export interface BodyBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The ring (a square) and the dot's centre, as fractions of the bot's size. */
export interface BotAnchors {
  readonly ring: { readonly left: number; readonly top: number; readonly side: number }
  readonly dot: { readonly x: number; readonly y: number }
}

/** Clear space between the body and the ring, each side, of the bot's size. */
export const RING_MARGIN = 0.06

/** Paint this opaque or more counts as the bot (an antialiased edge does not). */
const OPAQUE = 40

/**
 * The painted pixels' bounds in a canvas's RGBA data, in canvas pixels
 * (right and bottom exclusive), or undefined for an empty canvas.
 */
export function paintedBounds(
  data: ArrayLike<number>,
  width: number,
  height: number
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | undefined {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    for (let x = 0; x < width; x += 1) {
      if ((data[row + x * 4 + 3] ?? 0) > OPAQUE) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  return right < 0 ? undefined : { left, top, right: right + 1, bottom: bottom + 1 }
}

/**
 * The ring: a square round the body with RING_MARGIN clear on its longer
 * side, centred on it. The dot: where an avatar's status dot sits, on the
 * body's lower right -- the 45-degree point of the ellipse inside its bounds,
 * so a round ghost and a square droid both wear it on their edge rather than
 * floating off a corner.
 */
export function anchorsOf(body: BodyBox): BotAnchors {
  const width = body.right - body.left
  const height = body.bottom - body.top
  const centreX = (body.left + body.right) / 2
  const centreY = (body.top + body.bottom) / 2
  const side = Math.max(width, height) + 2 * RING_MARGIN
  const reach = Math.SQRT1_2 / 2
  return {
    ring: { left: centreX - side / 2, top: centreY - side / 2, side },
    dot: { x: centreX + reach * width, y: centreY + reach * height }
  }
}

/**
 * The anchors as the CSS variables the ring and the dot read (shell.css),
 * percentages of the bot's box. The dot is placed by its right and bottom
 * and pulled half its own size back (translate), so its CENTRE lands there
 * whatever size it is drawn at.
 */
export function anchorVariables(anchors: BotAnchors): Readonly<Record<string, string>> {
  const percent = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`
  return {
    '--lc-bot-ring-left': percent(anchors.ring.left),
    '--lc-bot-ring-top': percent(anchors.ring.top),
    '--lc-bot-ring-side': percent(anchors.ring.side),
    '--lc-bot-dot-right': percent(1 - anchors.dot.x),
    '--lc-bot-dot-bottom': percent(1 - anchors.dot.y),
    '--lc-bot-dot-shift': '50%'
  }
}
