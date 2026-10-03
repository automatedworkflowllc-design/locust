/**
 * Generative teammate avatars: the face is a few small choices on an 8x8
 * grid, seeded from the teammate's immutable id and overridable by the person.
 *
 * Shared between the store (which seeds a face when a teammate is created and
 * validates an override) and the renderer (which draws it, and seeds one for
 * teammates recorded before faces were persisted). One seed function in one
 * place, so a face can never depend on which side computed it.
 *
 * The seed is the ID, never the name: a rename must not change a face, and two
 * teammates who happen to share a name must not share one either.
 */

export const HEADWEAR_COUNT = 6
export const ACCESSORY_COUNT = 3
export const MOUTH_COUNT = 4

/**
 * THE BOTS. Colin, 2026-09-22, on libraries.dev/bots: *"this is actually
 * fucking perfect brother, this could revamp our design so much"*, and then
 * *"we're going to have to make miniature versions of the little bots for our
 * sidebar as well and chat as well and teammate picker panel"*.
 *
 * A teammate's face is a bot: one of bot-avatars' eighteen shapes or one of
 * Locust's own two ("why not both? its our branding"), with eyes alone or a
 * mouth. A shape the person picks is kept on the record (`bot`); otherwise --
 * every teammate made before bots, and every shuffled look -- it is DERIVED
 * from the same three seeded choices the pixel face was drawn from, so it is
 * as stable as the face was and nothing on disk has to change.
 */
export const BOT_SHAPES = [
  'clover',
  'flower',
  'triangle',
  'square',
  'blob',
  'ghost',
  'circle',
  'drop',
  'star',
  'droid',
  'mech',
  'alien',
  'hexagon',
  'cat',
  'cloud',
  'pill',
  'pebble',
  'puddle',
  'hopper',
  'swarm',
  // Picked only (0.559): never in DERIVED_SHAPES, so no teammate's face changes for them.
  'critter',
  'prompt'
] as const

/** The shapes a look is derived from: the first twenty, for good -- a new shape must never move anyone's face. */
const DERIVED_SHAPES = BOT_SHAPES.slice(0, 20)

export type BotShape = (typeof BOT_SHAPES)[number]
export type BotFace = 'eyes' | 'mouth'

export interface BotSpec {
  readonly shape: BotShape
  readonly face: BotFace
}

export function isBotSpec(value: unknown): value is BotSpec {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.shape === 'string' &&
    (BOT_SHAPES as readonly string[]).includes(record.shape) &&
    (record.face === 'eyes' || record.face === 'mouth')
  )
}

/** The teammate's bot: the one they picked, or the one their seeded look maps to. */
export function botFor(avatar: AvatarSpec): BotSpec {
  if (avatar.bot !== undefined && isBotSpec(avatar.bot)) return avatar.bot
  const index =
    (avatar.headwear * ACCESSORY_COUNT * MOUTH_COUNT + avatar.accessory * MOUTH_COUNT + avatar.mouth) %
    DERIVED_SHAPES.length
  return {
    shape: DERIVED_SHAPES[index] ?? 'clover',
    // The open mouth of the pixel face is the one that becomes a mouth.
    face: avatar.mouth === 2 ? 'mouth' : 'eyes'
  }
}

export interface AvatarSpec {
  /** plain, cans, bangs, buns, cap, antenna */
  readonly headwear: 0 | 1 | 2 | 3 | 4 | 5
  /** none, goggle frame, brows */
  readonly accessory: 0 | 1 | 2
  /** line-2, line-4, open, smirk */
  readonly mouth: 0 | 1 | 2 | 3
  /** The bot the person picked. Absent: derived from the three above (`botFor`). */
  readonly bot?: BotSpec
}

/** Half-cell coordinates on the even 0-14 grid, as the spec tabulates them. */
export type FaceCell = readonly [x: number, y: number]

export const HEADWEAR: readonly (readonly FaceCell[])[] = [
  [],
  [[2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [0, 4], [0, 6], [14, 4], [14, 6]],
  [[2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2]],
  [[4, 2], [6, 2], [8, 2], [10, 2], [0, 4], [0, 6], [14, 4], [14, 6]],
  [[4, 0], [6, 0], [8, 0], [10, 0], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2]],
  [[6, 0], [6, 2], [4, 4], [6, 4], [8, 4], [10, 4]]
]

export const ACCESSORY: readonly (readonly FaceCell[])[] = [[], [[2, 6], [12, 6]], [[2, 4], [12, 4]]]

export const MOUTH: readonly (readonly FaceCell[])[] = [
  [[6, 10], [8, 10]],
  [[4, 10], [6, 10], [8, 10], [10, 10]],
  [[6, 10], [8, 10], [6, 12], [8, 12]],
  [[6, 10], [8, 12]]
]

/** Always these two cells; only their motion varies. */
export const EYES: readonly FaceCell[] = [[4, 6], [10, 6]]

/**
 * FNV-1a over the id, a final avalanche so ids that differ in one trailing
 * character still land on different faces (plain FNV-1a leaves its low bits
 * barely mixed for that case, and the part windows read the low bits), then
 * independent byte windows for each part. The hue is NOT seeded here: it is
 * the person's own choice on the teammate record, and the store validates it.
 */
export function seedAvatar(id: string): AvatarSpec {
  let hash = 2166136261
  for (const character of id) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  const part = (shift: number, modulus: number): number => ((hash >>> shift) & 0xff) % modulus
  return {
    headwear: part(4, HEADWEAR_COUNT) as AvatarSpec['headwear'],
    accessory: part(12, ACCESSORY_COUNT) as AvatarSpec['accessory'],
    mouth: part(20, MOUTH_COUNT) as AvatarSpec['mouth']
  }
}

export function isAvatarSpec(value: unknown): value is AvatarSpec {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const within = (entry: unknown, count: number): boolean =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < count
  return within(record.headwear, HEADWEAR_COUNT)
    && within(record.accessory, ACCESSORY_COUNT)
    && within(record.mouth, MOUTH_COUNT)
    && (record.bot === undefined || isBotSpec(record.bot))
}

/**
 * What goes on disk: the known fields and nothing else. `isAvatarSpec`
 * checks the fields it knows and lets any others through, so a record could
 * carry whatever an input added; the store writes this instead.
 */
export function cleanAvatar(avatar: AvatarSpec): AvatarSpec {
  return {
    headwear: avatar.headwear,
    accessory: avatar.accessory,
    mouth: avatar.mouth,
    ...(avatar.bot === undefined ? {} : { bot: { shape: avatar.bot.shape, face: avatar.bot.face } })
  }
}

/**
 * The next look: every part advances together, so a shuffle always changes
 * something -- and a shape the person had picked gives way to the derived one,
 * so shuffling moves through the bots too.
 */
export function shuffledAvatar(current: AvatarSpec): AvatarSpec {
  return {
    headwear: ((current.headwear + 1) % HEADWEAR_COUNT) as AvatarSpec['headwear'],
    accessory: ((current.accessory + 1) % ACCESSORY_COUNT) as AvatarSpec['accessory'],
    mouth: ((current.mouth + 1) % MOUTH_COUNT) as AvatarSpec['mouth']
  }
}

/** Pixel size for a chip of `size`: `max(2, round(size * 0.72 / 8))`. */
export function facePixelSize(size: number): number {
  return Math.max(2, Math.round((size * 0.72) / 8))
}

/** Chip corner radius: `max(4, round(size / 6))`. */
export function chipRadius(size: number): number {
  return Math.max(4, Math.round(size / 6))
}

export interface LayerGeometry {
  readonly left: number
  readonly top: number
  /** `box-shadow` offsets for every cell after the first; empty for one cell. */
  readonly shadow: string
}

/**
 * One layer is ONE element: its first cell is the base pixel and every other
 * cell is a `box-shadow` offset from it. Coordinates are half-cells, so a
 * cell is `coordinate / 2 * p`.
 */
export function layerGeometry(cells: readonly FaceCell[], pixel: number, color: string): LayerGeometry | undefined {
  const base = cells[0]
  if (base === undefined) return undefined
  const [bx, by] = base
  return {
    left: (bx / 2) * pixel,
    top: (by / 2) * pixel,
    shadow: cells
      .slice(1)
      .map(([x, y]) => `${((x - bx) / 2) * pixel}px ${((y - by) / 2) * pixel}px 0 ${color}`)
      .join(', ')
  }
}
