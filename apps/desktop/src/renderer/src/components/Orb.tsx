import { ThinkingOrb } from 'thinking-orbs'

import type { OrbState } from 'thinking-orbs'
import type { ReactElement } from 'react'

/**
 * One orb, drawn from the asset that actually looks like the asset.
 *
 * THE LIBRARY SHIPS TWO DRAWINGS PER ORB, and its own types say why:
 * *"Exactly two tuned presets ship: 64 (chat-avatar scale) and 20
 * (inline-text scale). Each size carries its own dot count, dot size and
 * speed tuning — they are separate designs, not a scale factor."*
 *
 * The 20 preset is therefore a deliberate design, not a degraded one — but
 * it is a different picture, and how different is measurable from the
 * library's own preset table: at 20 the rubik keeps 25% of its points at
 * 1.8x the dot size, and the web keeps 19% at 1.5x. Colin, looking at the
 * shipped app beside the library's page: *"the one we have set for 'using a
 * tool' doesnt even look like any of the ones in that asset pack lol"*. He
 * was right, and nothing had been redrawn — all 23 files are byte-identical
 * to the published tarball. We were simply showing the other design.
 *
 * So this renders the 64 asset into a box smaller than 64. That is a
 * DOWNSCALE, which is sharp — the opposite of the first attempt, a CSS
 * transform on the 20px raster, which Colin correctly called cooking the
 * resolution.
 *
 * `box` is the space it gets, and it is a real dial rather than a constant
 * because some of these need more room than others to read at all. Colin,
 * setting the expectation before the work: *"its certainly possible once we
 * do this that some of these assets will either need to be given more
 * space/size to be legibile or we might have to scrap them altogether for
 * ones that are more visible to the naked eye"*.
 *
 * WHERE THE 20 PRESET IS STILL RIGHT: below about 18px there is not enough
 * room for the 64 asset's point count and it turns to mud. The sidebar's
 * conversation row is that case, and it keeps the inline design it was
 * designed for.
 */
/**
 * Which shapes the 64 asset actually improves, decided by rendering all nine
 * in the live line's own geometry and looking.
 *
 * THE RULE THE PICTURES MADE: the 64 asset wins wherever a shape's identity
 * is carried by POINT DENSITY -- the rubik's bands, the web's constellation,
 * the braid's strands, the globe's and wave's surfaces, the ribbon's sash.
 * At 20 those are a handful of fat dots and the shape is unrecognisable,
 * which is exactly what Colin saw: *"the one we have set for 'using a tool'
 * doesnt even look like any of the ones in that asset pack lol"*.
 *
 * It LOSES wherever the shape is an OUTLINE. `shaping` is a dotted square and
 * `breathing` a dotted ring: at 64 their outlines are hairline-thin and fade
 * into the panel, while the 20 preset deliberately fattens them, which is the
 * whole reason that design exists. Colin predicted this before the work --
 * *"some of these assets will either need to be given more space/size to be
 * legibile or we might have to scrap them altogether"* -- and the answer for
 * those two is neither: they already have a design tuned for this size.
 *
 * So the preset is chosen per shape. Mixing them is not an inconsistency: the
 * nine are different drawings anyway, and the thing that must be consistent
 * is that each one READS.
 */
const DENSE: ReadonlySet<OrbState> = new Set([
  'composing', 'listening', 'solving', 'searching', 'connecting', 'weaving'
])

export function Orb({
  state,
  box,
  label
}: {
  readonly state: OrbState
  /** CSS pixels the drawing gets. 64 is painted down into this. */
  readonly box: number
  readonly label?: string
}): ReactElement {
  const dense = DENSE.has(state)
  return (
    <ThinkingOrb
      state={state}
      size={dense ? 64 : 20}
      theme="dark"
      // An outline shape keeps its own 20px drawing at its own 20px size,
      // centred in the same box. Painting it into 26 would stretch a design
      // tuned for 20 and undo the point of keeping it.
      style={dense ? { width: box, height: box, display: 'block' } : { display: 'block' }}
      {...(label === undefined ? { 'aria-hidden': true } : { 'aria-label': label })}
    />
  )
}

/**
 * The size the live line and the plan step give an orb.
 *
 * 26 rather than 20: the 64 asset needs the room, and at 20 its points are
 * too fine to separate. The row's box grows with it rather than the drawing
 * spilling out of a 20px box, so nothing overlaps the word beside it.
 */
export const ORB_BOX = 26
