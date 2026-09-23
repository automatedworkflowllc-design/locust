import type { ReactElement } from 'react'
import { Liquid } from 'liquid-gooey'

import { effortDescription, effortName } from '../effortLevels.js'

/**
 * THE EFFORT CONTROL: CLAUDE CODE'S, ON LIBRARIES.DEV'S GOOEY SLIDER.
 *
 * Colin, 2026-09-22, with a frame of Claude Code's effort control ("Effort
 * Max", Faster to Smarter, a dotted track and a white thumb): "lets add the
 * gooey slider from this https://libraries.dev/gooey into our effort slider
 * and make it like this but for UI, we're just going to have to add fast
 * variant and adjusted effort names for each model variant"; and 2026-09-23,
 * "handle the gooey slider idea with exact same type as Claude code fit to our
 * Ui".
 *
 * So, top to bottom, as Claude Code draws it: the word Effort and the level's
 * name, a ? that says what the level costs; Faster and Smarter at the ends;
 * a rounded track with a dot at every stop and the part up to the level
 * filled; a white pill thumb. The thumb is the page's liquid slider (the Move
 * demo, "the live Slider, verbatim"): its surface is a liquid blob that chases
 * it on a spring and leaves a droplet tail, so a step from one level to the
 * next pours rather than jumps. Same goo and the page's slider knobs.
 *
 * The stops are the model's own (effortScale.ts), named in words
 * (`effortName`), and a model with fast variants gets the switch below.
 *
 * The CONTROL is still the native range input, laid over the track and
 * transparent: its keyboard, its screen-reader semantics and its snapping to
 * whole stops are the browser's, and every drive that sets a level sets it
 * there. What is drawn follows its value.
 */

/** The page's slider defaults (MOVE_DEFAULTS) and goo. */
const MOVE = { springiness: 0.5, wobble: 0.5, stretch: 0.6, trail: 0.35 }
const GOO = { blur: 6, contrast: 18, waviness: 0 }
/** The track's inner width, and the thumb's: stops sit this far in from each end. */
export const EFFORT_TRACK_WIDTH = 216
const THUMB_WIDTH = 12
const INSET = THUMB_WIDTH / 2 + 5

/** Where stop `index` of `count` sits, along the track, in px from its left edge. */
export function stopPosition(index: number, count: number): number {
  if (count < 2) return EFFORT_TRACK_WIDTH / 2
  return INSET + (index * (EFFORT_TRACK_WIDTH - 2 * INSET)) / (count - 1)
}

/** The thumb's liquid, read once from the tokens: the palette has one definition. */
let thumb: { readonly fill: string; readonly shadow: string } | undefined
function thumbSurface(): { readonly fill: string; readonly shadow: string } {
  if (thumb !== undefined) return thumb
  if (typeof document === 'undefined') return { fill: 'currentColor', shadow: 'none' }
  const style = getComputedStyle(document.documentElement)
  thumb = {
    fill: style.getPropertyValue('--lc-effort-thumb').trim() || 'currentColor',
    shadow: style.getPropertyValue('--lc-effort-thumb-shadow').trim() || 'none'
  }
  return thumb
}

export function EffortSlider({
  bases,
  index,
  fast,
  hasFast,
  footer,
  onPick,
  onFast
}: {
  /** The model's levels, lowest first, fast variants folded out. */
  readonly bases: readonly string[]
  readonly index: number
  readonly fast: boolean
  readonly hasFast: boolean
  readonly footer: string | undefined
  readonly onPick: (base: string) => void
  readonly onFast: (next: boolean) => void
}): ReactElement {
  const level = bases[index] ?? bases[0] ?? ''
  const x = stopPosition(index, bases.length)
  const meaning = effortDescription(level)
  const { fill, shadow } = thumbSurface()
  return (
    <>
      <div className="lc-effortpanel__head">
        <span className="lc-effortpanel__label">Effort</span>
        <span className="lc-effortpanel__now">
          {effortName(level)}
          {fast ? ' · Fast' : ''}
        </span>
        {/* Claude Code's ?, carrying what the level costs. */}
        <span
          className="lc-effortpanel__what"
          role="img"
          aria-label={meaning === undefined ? `${effortName(level)} effort` : `${effortName(level)}: ${meaning}`}
          title={meaning === undefined ? 'How hard the model thinks before it answers' : `${effortName(level)}: ${meaning}`}
        >
          ?
        </span>
      </div>
      <div className="lc-effortpanel__ends">
        <span>Faster</span>
        <span>Smarter</span>
      </div>
      <span className="lc-effortpanel__scale" style={{ width: EFFORT_TRACK_WIDTH }}>
        <span className="lc-effortpanel__track" aria-hidden="true" />
        <span className="lc-effortpanel__fill" style={{ width: x }} aria-hidden="true" />
        <span className="lc-effortpanel__notches" aria-hidden="true">
          {bases.map((base, stop) => (
            <span
              key={base}
              className={`lc-effortpanel__notch${stop <= index ? ' is-passed' : ''}`}
              style={{ left: stopPosition(stop, bases.length) }}
            />
          ))}
        </span>
        <Liquid
          blur={GOO.blur}
          contrast={GOO.contrast}
          fill={fill}
          shadow={shadow}
          waviness={GOO.waviness}
          className="lc-effortpanel__liquid"
        >
          <Liquid.Item effect="move" move={MOVE}>
            <span className="lc-effortpanel__thumb" style={{ transform: `translateX(${String(x - THUMB_WIDTH / 2)}px)` }} />
          </Liquid.Item>
        </Liquid>
        <input
          className="lc-effortpanel__slider"
          type="range"
          min={0}
          max={Math.max(0, bases.length - 1)}
          step={1}
          value={index}
          aria-label="Reasoning effort"
          aria-valuetext={effortName(level)}
          disabled={bases.length < 2}
          onChange={(event) => {
            const next = bases[Number(event.currentTarget.value)]
            if (next !== undefined) onPick(next)
          }}
        />
      </span>
      {hasFast && (
        <button
          type="button"
          role="switch"
          aria-checked={fast}
          className={`lc-effortpanel__fast${fast ? ' is-on' : ''}`}
          onClick={() => onFast(!fast)}
        >
          <span>Fast variant</span>
          {/* A switch track, not a filled button: Colin, 2026-09-08, "just
              make the fast variant a simple toggle bar, doesnt need to be so
              big". */}
          <span className="lc-switch" aria-hidden="true">
            <span className="lc-switch__knob" />
          </span>
        </button>
      )}
      {footer !== undefined && <p className="lc-menu__foot">{footer}</p>}
    </>
  )
}
