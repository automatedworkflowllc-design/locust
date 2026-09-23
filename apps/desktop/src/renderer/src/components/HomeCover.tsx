import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

import type { AvatarSpec } from '../../../shared/avatar.js'
import type { TubePreference } from '../../../shared/ipc.js'
import { PixelFace } from './PixelFace.js'
import type { FaceActivity, FacePresence, PixelFaceHue } from './PixelFace.js'
import { PoweredLockup } from './PoweredLockup.js'

/**
 * THE DESIGN SYSTEM'S COVER, ON THE HOME SCREEN.
 *
 * 0.270 put only the cover's lockup here, and Colin, looking at it: *"it can
 * be a 1:1 once you fix the text description under locust tbh ... cause right
 * now it just looks like the locust logo and crt shipped"*. So this is the
 * whole cover: the lockup lighting up with the claim centred under it, and
 * three teammates on their plate, each in a real state -- Wren working, Atlas
 * waiting on you, Sable idle.
 *
 * ONE DRAWING, TO SCALE. Every number below is the cover's own, on its own
 * 960x288 canvas, and the card draws it at the column's width: the column is
 * 760 to 980px wide, so the card is the cover at 0.79 to 1.02 of its size
 * rather than a rearrangement of it. Faces are sized in whole pixels at that
 * scale, so the pixel art stays on its grid instead of being resampled.
 *
 * The faces wake with the lockup: still, with no presence dot, until the
 * runtimes have answered -- the moment the loading screen's work is done and
 * the cover comes on.
 */

/** The cover's canvas, in its own units. Everything is placed on it. */
export const COVER_WIDTH = 960
export const COVER_HEIGHT = 288

/** The narrowest reading column, and so the scale the card starts at before it is measured. */
const FIRST_SCALE = 760 / COVER_WIDTH

/** The cover drawn to fit a card this many pixels wide. */
export function coverScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return Math.round(FIRST_SCALE * 1000) / 1000
  return Math.round((width / COVER_WIDTH) * 1000) / 1000
}

interface CoverFace {
  readonly key: string
  readonly hue: PixelFaceHue
  readonly avatar: AvatarSpec
  readonly activity: FaceActivity
  readonly presence: FacePresence
  /** Top-left on the cover's canvas, where the face is 120 across. */
  readonly x: number
  readonly y: number
}

/** The cover's cast, exactly as the design system draws them. */
export const COVER_CAST: readonly CoverFace[] = [
  { key: 'wren', hue: 'lime', avatar: { headwear: 1, accessory: 0, mouth: 0 }, activity: 'working', presence: 'working', x: 536, y: 76 },
  { key: 'atlas', hue: 'blue', avatar: { headwear: 2, accessory: 1, mouth: 0 }, activity: 'waiting', presence: 'approval', x: 680, y: 100 },
  { key: 'sable', hue: 'clay', avatar: { headwear: 4, accessory: 2, mouth: 3 }, activity: 'idle', presence: 'none', x: 824, y: 64 }
]

const FACE = 120

export function HomeCover({
  ready,
  tube
}: {
  /** The runtimes have answered: the loading screen's work is done. */
  readonly ready: boolean
  readonly tube: TubePreference
}): ReactElement {
  const card = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(() => coverScale(0))

  useEffect(() => {
    const element = card.current
    if (element === null) return undefined
    const measure = (): void => setScale(coverScale(element.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const at = (value: number): number => Math.round(value * scale)
  return (
    <div className="lc-cover" ref={card} style={{ '--lc-cover-k': String(scale) } as CSSProperties}>
      <div className="lc-cover__plate" aria-hidden="true" />
      {COVER_CAST.map((face) => (
        <span key={face.key} className="lc-cover__face" style={{ left: at(face.x), top: at(face.y) }}>
          <PixelFace
            hue={face.hue}
            avatar={face.avatar}
            size={at(FACE)}
            activity={ready ? face.activity : 'idle'}
            presence={ready ? face.presence : 'none'}
          />
        </span>
      ))}
      <div className="lc-cover__brand">
        <PoweredLockup ready={ready} tube={tube} />
        <p className="lc-cover__claim">Autonomous teammates on your own machine</p>
      </div>
    </div>
  )
}
