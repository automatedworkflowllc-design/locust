import type { CSSProperties, ReactElement } from 'react'

import type { TeammateHue } from '../../../shared/ipc.js'
import { ACCESSORY, chipRadius, EYES, facePixelSize, HEADWEAR, layerGeometry, MOUTH } from '../../../shared/avatar.js'
import type { AvatarSpec, FaceCell } from '../../../shared/avatar.js'

/**
 * A generated teammate face: a rounded chip in the teammate's hue, with the
 * face drawn as CSS pixels on an 8x8 grid. Four elements at most -- features,
 * eyes, mouth, and the chip -- each layer ONE span whose extra pixels are
 * `box-shadow` offsets. No SVG, no images, crisp at every size.
 *
 * Motion is a status signal, not decoration: a face moves only while that
 * teammate is actually doing something. Every other state is perfectly still,
 * and because motion can be off (reduced motion), state is always also carried
 * by the presence dot and by adjacent text.
 *
 * Faces are decorative -- identity is the name beside them -- so the chip is
 * aria-hidden.
 */

export type PixelFaceHue = TeammateHue

/** What the teammate is doing, which is the only thing that may animate a face. */
export type FaceActivity = 'working' | 'receiving' | 'still'

/** The presence dot: lime working, amber approval pending, red blocked, none when idle. */
export type FacePresence = 'working' | 'approval' | 'blocked' | 'none'

export interface PixelFaceProps {
  readonly hue: PixelFaceHue
  readonly avatar: AvatarSpec
  readonly size?: number
  readonly activity?: FaceActivity
  readonly presence?: FacePresence
  readonly className?: string
}

const HUE_VARIABLE: Readonly<Record<PixelFaceHue, string>> = {
  lime: '--lc-hue-lime',
  blue: '--lc-hue-blue',
  violet: '--lc-hue-violet',
  clay: '--lc-hue-clay'
}

const FACE_VARIABLE: Readonly<Record<PixelFaceHue, string>> = {
  lime: '--lc-hue-lime-face',
  blue: '--lc-hue-blue-face',
  violet: '--lc-hue-violet-face',
  clay: '--lc-hue-clay-face'
}

const PRESENCE_TONE: Readonly<Record<FacePresence, string | undefined>> = {
  working: 'lime',
  approval: 'amber',
  blocked: 'red',
  none: undefined
}

function Layer({
  cells,
  pixel,
  color,
  animation,
  origin
}: {
  readonly cells: readonly FaceCell[]
  readonly pixel: number
  readonly color: string
  readonly animation: string | undefined
  readonly origin: string | undefined
}): ReactElement | null {
  const geometry = layerGeometry(cells, pixel, color)
  if (geometry === undefined) return null
  const style: CSSProperties = {
    position: 'absolute',
    left: geometry.left,
    top: geometry.top,
    width: pixel,
    height: pixel,
    background: color,
    display: 'block',
    ...(geometry.shadow.length > 0 ? { boxShadow: geometry.shadow } : {}),
    ...(origin === undefined ? {} : { transformOrigin: origin }),
    ...(animation === undefined ? {} : { animation })
  }
  return <span className="lc-face__layer" style={style} />
}

export function PixelFace({
  hue,
  avatar,
  size = 32,
  activity = 'still',
  presence = 'none',
  className
}: PixelFaceProps): ReactElement {
  const pixel = facePixelSize(size)
  const grid = pixel * 8
  const color = `var(${FACE_VARIABLE[hue]})`
  const working = activity === 'working'
  const eyesMove = activity === 'working' || activity === 'receiving'

  const outer: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    width: size,
    height: size,
    flexShrink: 0
  }
  const chip: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: chipRadius(size),
    background: `var(${HUE_VARIABLE[hue]})`,
    // Border is the chip hue at half alpha, so it reads as the same material.
    border: `1px solid color-mix(in srgb, var(${HUE_VARIABLE[hue]}) 55%, transparent)`,
    boxSizing: 'border-box',
    overflow: 'hidden',
    ...(working ? { animation: 'lcBob 2.6s ease-in-out infinite' } : {})
  }
  const box: CSSProperties = {
    position: 'absolute',
    left: Math.round((size - grid) / 2) - 1,
    top: Math.round((size - grid) / 2) - 1,
    width: grid,
    height: grid,
    display: 'block'
  }
  const tone = PRESENCE_TONE[presence]

  return (
    <span className={`lc-face${className === undefined ? '' : ` ${className}`}`} style={outer} aria-hidden="true">
      <span className={`lc-face__chip${working ? ' is-working' : ''}`} style={chip}>
        <span style={box}>
          <Layer
            cells={[...HEADWEAR[avatar.headwear]!, ...ACCESSORY[avatar.accessory]!]}
            pixel={pixel}
            color={color}
            animation={undefined}
            origin={undefined}
          />
          <Layer
            cells={EYES}
            pixel={pixel}
            color={color}
            animation={eyesMove ? 'lcEyes 5s ease-in-out infinite' : undefined}
            origin="center"
          />
          <Layer
            cells={MOUTH[avatar.mouth]!}
            pixel={pixel}
            color={color}
            animation={working ? 'lcChat 1.5s ease-in-out infinite' : undefined}
            origin="center top"
          />
        </span>
      </span>
      {tone !== undefined && <span className={`lc-presence lc-presence--${tone}`} />}
    </span>
  )
}
