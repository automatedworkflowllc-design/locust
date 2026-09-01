import type { CSSProperties, ReactElement } from 'react'

/**
 * An 8-bit teammate face: a rounded square in the teammate's hue with a face
 * drawn as CSS pixels -- one base pixel plus `box-shadow` offsets on an 8x8
 * grid. No SVG, no emoji, crisp at every size, and it scales by recomputing
 * the pixel size rather than by resampling an image.
 *
 * Grid coordinates are the even numbers 0-14 from the design spec, which are
 * half-cell units: cell = coordinate / 2, so (12,10) is the 7th column, 6th
 * row. Faces are decorative -- identity is always carried by adjacent text --
 * so the element is aria-hidden.
 */

export type PixelFaceHue = 'lime' | 'blue' | 'violet' | 'clay'

/** Half-cell coordinates on the 0-14 grid, exactly as the spec tabulates them. */
export type FacePixel = readonly [x: number, y: number]

export interface PixelFaceProps {
  readonly hue: PixelFaceHue
  readonly pixels: readonly FacePixel[]
  readonly size?: number
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

/** The four faces the design specifies, by the role each teammate plays. */
export const FACE_PRESETS: Readonly<Record<string, readonly FacePixel[]>> = {
  // Cropped hair, two eyes, small mouth.
  wren: [
    [2, 0], [4, 0], [6, 0], [8, 0], [10, 0], [12, 0], [2, 2], [12, 2],
    [4, 6], [10, 6],
    [6, 10], [8, 10]
  ],
  // Bangs, two eyes, flat mouth.
  atlas: [
    [4, 2], [6, 2], [8, 2], [10, 2],
    [4, 6], [10, 6],
    [4, 10], [6, 10], [8, 10], [10, 10]
  ],
  // Cowlick, two eyes, open mouth.
  juno: [
    [12, 0], [12, 2],
    [4, 6], [10, 6],
    [6, 10], [8, 10], [6, 12], [8, 12]
  ],
  // Brows, two eyes, small mouth.
  sable: [
    [2, 2], [4, 2], [10, 2], [12, 2],
    [4, 6], [10, 6],
    [6, 10], [8, 10]
  ]
}

/**
 * Pixel size is `round(size * 0.72 / 8)` per the spec, floored at 1 so a very
 * small avatar degrades to a visible face rather than to nothing.
 */
export function facePixelSize(size: number): number {
  return Math.max(1, Math.round((size * 0.72) / 8))
}

function faceShadow(pixels: readonly FacePixel[], size: number): string {
  const pixel = facePixelSize(size)
  // The grid is 8 cells wide in pixel units; center it in the chip.
  const origin = Math.round((size - pixel * 8) / 2)
  return pixels
    .map(([x, y]) => `${origin + (x / 2) * pixel}px ${origin + (y / 2) * pixel}px 0 0 currentColor`)
    .join(', ')
}

export function PixelFace({ hue, pixels, size = 32, className }: PixelFaceProps): ReactElement {
  const pixel = facePixelSize(size)
  const chip: CSSProperties = {
    width: size,
    height: size,
    // The reference uses a small fixed radius at every avatar size (5px on a
    // 30px chip), which reads as a pixel-art tile rather than a rounded app
    // icon. A proportional radius rounds the corners off the illusion.
    borderRadius: size >= 44 ? 7 : 5,
    background: `var(${HUE_VARIABLE[hue]})`,
    // Border is the chip hue at 50% alpha, so it reads as the same material.
    border: `1px solid color-mix(in srgb, var(${HUE_VARIABLE[hue]}) 55%, transparent)`,
    color: `var(${FACE_VARIABLE[hue]})`,
    position: 'relative',
    flexShrink: 0,
    boxSizing: 'border-box'
  }
  const face: CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: pixel,
    height: pixel,
    // The base pixel is itself part of the face only if (0,0) is in the set;
    // it is not in any preset, so it is transparent and the shadows draw it.
    background: 'transparent',
    boxShadow: faceShadow(pixels, size)
  }
  return (
    <span className={className} style={chip} aria-hidden="true">
      <span style={face} />
    </span>
  )
}
