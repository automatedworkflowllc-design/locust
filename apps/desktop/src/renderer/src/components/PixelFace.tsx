import type { CSSProperties, ReactElement } from 'react'

import type { TeammateHue } from '../../../shared/ipc.js'
import { ACCESSORY, chipRadius, EYES, facePixelSize, HEADWEAR, layerGeometry, MOUTH } from '../../../shared/avatar.js'
import type { AvatarSpec, FaceCell } from '../../../shared/avatar.js'
import { FACE_MOTION } from '../faceState.js'
import type { FaceActivity } from '../faceState.js'

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

export type { FaceActivity } from '../faceState.js'

/** The presence dot: lime working, amber approval pending, red blocked, none when idle. */
export type FacePresence = 'working' | 'approval' | 'blocked' | 'none'

export interface PixelFaceProps {
  readonly hue: PixelFaceHue
  readonly avatar: AvatarSpec
  readonly size?: number
  readonly activity?: FaceActivity
  readonly presence?: FacePresence
  readonly className?: string
  /**
   * The teammate this face stands for, for the audit that reads every chip
   * of one teammate off the DOM and requires them to agree. Faces with no
   * teammate (the runtime's own) carry none.
   */
  readonly teammateId?: string
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
  transform,
  origin
}: {
  readonly cells: readonly FaceCell[]
  readonly pixel: number
  readonly color: string
  readonly animation: string | undefined
  readonly transform?: string
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
    ...(animation === undefined ? {} : { animation }),
    ...(transform === undefined ? {} : { transform })
  }
  return <span className="lc-face__layer" style={style} />
}

export function PixelFace({
  hue,
  avatar,
  size = 32,
  activity = 'idle',
  presence = 'none',
  className,
  teammateId
}: PixelFaceProps): ReactElement {
  const pixel = facePixelSize(size)
  const grid = pixel * 8
  const color = `var(${FACE_VARIABLE[hue]})`
  // The one place motion is decided: the state, and nothing else, picks the
  // animation. Idle and blocked map to none; every other state moves.
  const motion = FACE_MOTION[activity]
  const chipBorder =
    activity === 'blocked'
      ? 'var(--lc-red)'
      : activity === 'waiting'
        ? 'var(--lc-amber)'
        : `color-mix(in srgb, var(${HUE_VARIABLE[hue]}) 55%, transparent)`

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
    border: `1px solid ${chipBorder}`,
    boxSizing: 'border-box',
    overflow: 'hidden',
    ...(motion.chip === undefined ? {} : { animation: motion.chip })
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
    <span
      className={`lc-face${className === undefined ? '' : ` ${className}`}`}
      style={outer}
      aria-hidden="true"
      data-activity={activity}
      {...(teammateId === undefined ? {} : { 'data-teammate': teammateId })}
    >
      {activity === 'waiting' && <span className="lc-face__ring" style={{ borderRadius: chipRadius(size) }} />}
      <span className={`lc-face__chip is-${activity}`} style={chip}>
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
            animation={motion.eyes}
            origin="center"
            // Blocked holds its eyes shut: told apart from idle without motion.
            {...(activity === 'blocked' ? { transform: 'scaleY(0.15)' } : {})}
          />
          <Layer cells={MOUTH[avatar.mouth]!} pixel={pixel} color={color} animation={motion.mouth} origin="center top" />
        </span>
      </span>
      {tone !== undefined && <span className={`lc-presence lc-presence--${tone}`} />}
    </span>
  )
}
