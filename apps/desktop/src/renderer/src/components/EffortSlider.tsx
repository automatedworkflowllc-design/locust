import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
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
 * filled; a white thumb, Claude Code's rounded rectangle. Under the thumb is
 * the page's liquid slider (the Move demo): a liquid drop that chases it on a
 * spring and leaves a droplet tail.
 *
 * THE POINTER HOLDS THE THUMB (0.301). Colin, 2026-09-23, with frames of ours,
 * Claude's and the gooey page's slider: "our effort slide is a little wonky
 * and responds a little oddly compared to claudes, lets also make sure this
 * gooey effect ... is used, might have to raise the intensity its not all that
 * visual to the user rn". Measured on 0.300 (probe-effort-slider): dragged,
 * the thumb sat up to 32px from the pointer -- it jumped from stop to stop as
 * the invisible range input under it changed value -- and the fill, on its
 * own 320ms ease, ran up to 38px from the thumb. The goo had nothing to show
 * for the same reason: the gooey page's slider looks liquid because its thumb
 * follows the pointer and the liquid chases it (its Slider demo: pointer
 * capture, `translateX(x)` straight from the pointer), and a thumb that only
 * jumps shows a blob that arrives. So it is held the way that slider is: the
 * thumb follows the pointer along the track with the fill under it, the level
 * names the nearest stop and is picked as it changes, and on letting go it
 * settles on that stop -- the liquid pouring the last of the way.
 *
 * THE THUMB IS DRAWN, NOT MELTED (2026-09-24). Colin, with frames of ours at
 * Medium and Claude Code's at Max: "our white ball/square is off and not
 * quite right, cc for reference". Measured off the two frames, which are at
 * one scale ("Faster" is 8 x 32px in both): Claude Code's thumb is a white
 * rounded rectangle, 16 x 20 with 4px corners, the full height of a 20px
 * track; ours was a ball about 10px across. The blob WAS the thumb, and a
 * 6px goo blur on a 12px-wide shape can only ever come out round. So the
 * thumb is its own crisp element, Claude Code's shape, over the liquid; the
 * liquid's source is a smaller drop hidden under it, so at rest nothing of
 * it shows, and when the thumb moves, the drop lagging on its spring pours
 * out behind it -- the gooey page's tail, without the ball.
 *
 * ONE THUMB, AND IT IS THE LIQUID (0.378). Colin, 2026-09-26: "the effort
 * ball is now a rectangle with no gooey with a gooey circle behind it, we
 * gotta pick one lol". Two things were drawn as one: a crisp rectangle, and
 * the drop's goo peeking out from behind it whenever it moved. The drop is
 * now the thumb itself, at Claude Code's size and corners, and the goo is
 * blurred only as much as keeps that shape at rest -- so at rest it IS the
 * rounded rectangle, and moved, that same thumb squashes and stretches. A far
 * press no longer restarts it where it lands: the thumb gliding across is
 * the effect, not a second ball chasing the first.
 *
 * AND NO TAIL. Colin, the same day, of the build before this: "its still
 * cooked, theres two different assets, if you cant make the main asset
 * gooey thats fine but no tail lol". The library's tail is a separate circle
 * chasing the thumb on a softer spring -- a second asset by another name --
 * so `trail` is 0 and the liquid is all in the thumb's own squash and
 * stretch. Its spring is stiff: the liquid IS the visible thumb now, and a
 * soft one would leave it trailing the pointer, the "wonky" drag of 0.300.
 *
 * The stops are the model's own (effortScale.ts), named in words
 * (`effortName`), and a model with fast variants gets the switch below.
 *
 * The range input is still the CONTROL for everything but a pointer: its
 * keyboard, its screen-reader semantics and its snapping are the browser's,
 * and every drive that sets a level sets it there. A press on the track
 * focuses it, so the arrow keys carry on from where the pointer left off.
 */

/**
 * The page's slider knobs (its MOVE_DEFAULTS: springiness 0.5, stretch 0.6,
 * trail 0.35), with the tail taken off (0.378, above), a stiffer spring so
 * the visible thumb stays with the pointer, and less wobble: at the
 * library's 0.5, a quick drag let go at either end threw the liquid past the
 * end of the track (frames 04, first tuning, probe-effort-slider).
 */
/** Squash and stretch, and no tail: the liquid is the thumb, one shape, close behind the pointer. */
export const MOVE = { springiness: 0.85, wobble: 0.2, stretch: 0.6, trail: 0 }
/**
 * Blurred as little as melts the tail into the thumb: at the old 6px, a
 * 16px-wide shape came out an oval, and Claude Code's corners are 4px.
 */
const GOO = { blur: 3, contrast: 20, waviness: 0 }
/** The track's inner width, and the thumb's: stops sit this far in from each end. */
export const EFFORT_TRACK_WIDTH = 216
/** Claude Code's thumb is 16px wide (and 20 tall, the track's height: shell.css). */
export const THUMB_WIDTH = 16
const INSET = THUMB_WIDTH / 2 + 5

/** Where stop `index` of `count` sits, along the track, in px from its left edge. */
export function stopPosition(index: number, count: number): number {
  if (count < 2) return EFFORT_TRACK_WIDTH / 2
  return INSET + (index * (EFFORT_TRACK_WIDTH - 2 * INSET)) / (count - 1)
}

/** Where a held thumb is: the pointer's place along the track, kept between the first stop and the last. */
export function heldAt(pointerX: number, trackLeft: number): number {
  return Math.min(EFFORT_TRACK_WIDTH - INSET, Math.max(INSET, pointerX - trackLeft))
}

/** The stop nearest a place on the track. */
export function nearestStop(x: number, count: number): number {
  if (count < 2) return 0
  const spacing = (EFFORT_TRACK_WIDTH - 2 * INSET) / (count - 1)
  return Math.min(count - 1, Math.max(0, Math.round((x - INSET) / spacing)))
}

/** The thumb's liquid, read once from the tokens: the palette has one definition. */
let thumb: { readonly fill: string; readonly shadow: string } | undefined
function thumbSurface(): { readonly fill: string; readonly shadow: string } {
  if (thumb !== undefined) return thumb
  if (typeof document === 'undefined') return { fill: 'currentColor', shadow: 'none' }
  const style = getComputedStyle(document.documentElement)
  // Both of the thumb's shadows, now that the liquid is the thumb: its own
  // close one, and Claude Code's soft lift, which only the crisp rectangle
  // used to carry. The library reads a box-shadow list.
  const shadows = ['--lc-effort-thumb-shadow', '--lc-effort-thumb-lift'].map((name) => style.getPropertyValue(name).trim()).filter((value) => value.length > 0)
  thumb = {
    fill: style.getPropertyValue('--lc-effort-thumb').trim() || 'currentColor',
    shadow: shadows.length === 0 ? 'none' : shadows.join(', ')
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
  const count = bases.length
  const control = useRef<HTMLInputElement>(null)
  /** Where the thumb is while a pointer holds it; undefined when it rests on its stop. */
  const [held, setHeld] = useState<number>()
  const x = held ?? stopPosition(index, count)
  const shown = held === undefined ? index : nearestStop(held, count)
  const level = bases[shown] ?? bases[0] ?? ''
  const meaning = effortDescription(level)
  const { fill, shadow } = thumbSurface()

  const hold = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    const place = heldAt(event.clientX, event.currentTarget.getBoundingClientRect().left)
    setHeld(place)
    const stop = nearestStop(place, count)
    const base = bases[stop]
    if (stop !== index && base !== undefined) onPick(base)
  }
  const letGo = (): void => setHeld(undefined)

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
      <span
        className={`lc-effortpanel__scale${held === undefined ? '' : ' is-held'}`}
        style={{ width: EFFORT_TRACK_WIDTH }}
        onPointerDown={(event) => {
          if (count < 2 || event.button !== 0) return
          event.preventDefault()
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // A synthetic event has no pointer to capture; the move still reads.
          }
          control.current?.focus({ preventScroll: true })
          hold(event)
        }}
        onPointerMove={(event) => {
          if (held !== undefined) hold(event)
        }}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onLostPointerCapture={letGo}
      >
        <span className="lc-effortpanel__track" aria-hidden="true" />
        <span className="lc-effortpanel__fill" style={{ width: x }} aria-hidden="true" />
        <span className="lc-effortpanel__notches" aria-hidden="true">
          {bases.map((base, stop) => (
            <span
              key={base}
              className={`lc-effortpanel__notch${stop <= shown ? ' is-passed' : ''}`}
              style={{ left: stopPosition(stop, count) }}
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
          {/* The thumb: its box is the shape the liquid paints, and nothing else draws it. */}
          <Liquid.Item effect="move" move={MOVE}>
            <span
              className="lc-effortpanel__thumb"
              style={{ transform: `translateX(${String(x - THUMB_WIDTH / 2)}px)` }}
              aria-hidden="true"
            />
          </Liquid.Item>
        </Liquid>
        <input
          ref={control}
          className="lc-effortpanel__slider"
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          step={1}
          value={index}
          aria-label="Reasoning effort"
          aria-valuetext={effortName(bases[index] ?? level)}
          disabled={count < 2}
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
