import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

import type { BotAvatarState } from 'bot-avatars'

import type { TeammateHue, TubePreference } from '../../../shared/ipc.js'
import { Beam } from './Beam.js'
import { Bot } from './Bot.js'
import type { BotType } from './Bot.js'
import { PoweredLockup } from './PoweredLockup.js'

/**
 * THE DESIGN SYSTEM'S COVER, ON THE HOME SCREEN.
 *
 * 0.270 put only the cover's lockup here, and Colin, looking at it: *"it can
 * be a 1:1 once you fix the text description under locust tbh ... cause right
 * now it just looks like the locust logo and crt shipped"*. So this is the
 * whole cover: the lockup lighting up with the claim centred under it, and
 * three teammates on their plate, each in a real state.
 *
 * THE TEAMMATES ARE BOTS (0.274). Colin, on libraries.dev/bots: *"this is
 * actually fucking perfect brother"*, then *"we will unfortunately have to
 * update the title screen as well, lets definitely include ghost in there"*.
 * Wren is a ghost, working; Atlas a droid, waiting on you (Locust's amber
 * ring and dot); Sable a Locust of our own, the Hopper, asleep. They follow a
 * pointer that comes near, and hop when clicked.
 *
 * ONE DRAWING, TO SCALE. Every number below is the cover's own, on its own
 * 960x288 canvas, and the card draws it at the column's width: the column is
 * 760 to 980px wide, so the card is the cover at 0.79 to 1.02 of its size
 * rather than a rearrangement of it. Bots are sized in whole pixels at that
 * scale.
 *
 * The bots wake with the lockup: still, with no presence dot, until the
 * runtimes have answered -- the moment the loading screen's work is done and
 * the cover comes on.
 */

/** The cover's canvas, in its own units. Everything is placed on it. */
export const COVER_WIDTH = 960
export const COVER_HEIGHT = 254

/** The narrowest reading column, and so the scale the card starts at before it is measured. */
const FIRST_SCALE = 760 / COVER_WIDTH

/** The cover drawn to fit a card this many pixels wide. */
export function coverScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return Math.round(FIRST_SCALE * 1000) / 1000
  return Math.round((width / COVER_WIDTH) * 1000) / 1000
}

interface CoverBot {
  readonly key: string
  readonly type: BotType
  /** A teammate hue, or none for the shape's own colour (the ghost's white). */
  readonly hue?: TeammateHue
  readonly state: BotAvatarState
  /** Floats instead of hopping: a slow bob, no idle jumps. */
  readonly floats?: boolean
  /** Locust's own marks: the presence dot, and the ring of a teammate waiting on you. */
  readonly dot?: 'lime' | 'amber'
  readonly waiting?: boolean
  /** Top-left on the cover's canvas, where a bot is 120 across. */
  readonly x: number
  readonly y: number
}

/**
 * The cover's cast. Colin, 2026-09-22: *"maybe make the ghost white and the
 * locust green lol"*, and of the ghost's working hops and spins: *"a little
 * loud for a title screen, especially for a ghost"* -- so it floats: the
 * library's idle look-around with no jumps, carried on a slow bob.
 */
export const COVER_CAST: readonly CoverBot[] = [
  { key: 'wren', type: 'ghost', state: 'default', floats: true, dot: 'lime', x: 245, y: -10 },
  { key: 'atlas', type: 'droid', hue: 'blue', state: 'default', dot: 'amber', waiting: true, x: 432, y: 0 },
  { key: 'sable', type: 'hopper', hue: 'lime', state: 'sleeping', x: 619, y: -2 }
]

/*
 * THE MACHINE (A2). His words,
 * 2026-09-23: "the title screen with border around logo and text,
 * teammates on top of logo, this would give it a more centered look, give
 * the locust logo and text have something to actually run the crt effect,
 * and the teammates could have a structure to be on top of, the border, crt
 * effect, would almost make it look like a machine as well so the text
 * under it would have a cooler meaning". So: the boot screen's own bezel and
 * glass, small, centred on the cover; the lockup lights INSIDE the glass;
 * the three stand on the bezel's top edge; the claim is its label.
 */
export const COVER_MACHINE = { x: 200, y: 86, width: 560, height: 162 } as const
/*
 * Colin, looking at the sample: "Let's make the screen bigger and put the
 * text in it as well". So the claim is on the glass under the lockup, where
 * the tube runs over it too, and the screen took the height the label under
 * it had used -- the cover stays 254 tall, so the first screen still fits at
 * 1120x720 (first-screen-fits.mjs, B11).
 */

/**
 * A teammate hue as a colour a canvas can take: the token's own value, read
 * off the page, so the palette still has one definition (tokens.css). Nothing
 * to read before there is a page; the bot then wears its own colour.
 */
function hueColor(hue: TeammateHue): string | undefined {
  if (typeof document === 'undefined') return undefined
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--lc-hue-${hue}`).trim()
  return value.length === 0 ? undefined : value
}

const FACE = 96

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
  /*
   * RESTING WHILE NOBODY IS LOOKING. The three move on every frame, and
   * plastic is lit per pixel: measured on the built app, about 11% of the
   * renderer while the home screen is up. A home screen left open behind
   * other work was paying that for no one. So they rest while the window is
   * in the background and pick up again when it comes back; a hidden window
   * already stops them.
   */
  const [awake, setAwake] = useState(() => typeof document === 'undefined' || document.hasFocus())
  useEffect(() => {
    const wake = (): void => setAwake(true)
    const rest = (): void => setAwake(false)
    window.addEventListener('focus', wake)
    window.addEventListener('blur', rest)
    // The window is shown, and focused, as the app loads: a focus that lands
    // between the first render and these listeners is missed by both, and
    // the loading beam would wait for the next one. Read it now instead.
    setAwake(document.hasFocus())
    return () => {
      window.removeEventListener('focus', wake)
      window.removeEventListener('blur', rest)
    }
  }, [])

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
    /*
     * A mono beam goes round the title box WHILE THE RUNTIMES ARE BEING
     * FOUND, and goes out as the lockup lights and the bots wake.
     *
     * Colin asked for it (2026-09-23: "a rotate large mono around the title
     * box with the logo in it"), and 0.278 ran it for as long as the home
     * screen was up. Then, having looked at it: "it just makes it look like
     * something is loading that isnt loading ... it just drags away your
     * eyes from all the other movement on screen". Both true, and the same
     * fact: a travelling light reads as loading. So it is shown exactly when
     * something IS loading -- before the bots move, never beside them. It
     * does not wait for the window's focus as the bots do: loading is a few
     * seconds, and a window that is still being shown may not have it yet.
     */
      <div className="lc-cover lc-cover--machine" ref={card} style={{ '--lc-cover-k': String(scale) } as CSSProperties}>
        <div
          className="lc-cover__machineslot"
          style={{ left: at(COVER_MACHINE.x), top: at(COVER_MACHINE.y), width: at(COVER_MACHINE.width), height: at(COVER_MACHINE.height) }}
        >
          <Beam size="md" strength={0.85} active={!ready} className="lc-coverbeam lc-coverbeam--machine">
            <div className="lc-cover__machine">
              <div className="lc-cover__glass">
                <span className="lc-cover__scan" aria-hidden="true" />
                <div className="lc-cover__screen">
                  <PoweredLockup ready={ready} tube={tube} />
                  <p className="lc-cover__claim">Autonomous teammates on your own machine</p>
                </div>
              </div>
            </div>
          </Beam>
        </div>
        {COVER_CAST.map((mate, index) => {
          const size = at(FACE)
          const color = mate.hue === undefined ? undefined : hueColor(mate.hue)
          return (
            <span key={mate.key} className="lc-cover__face" style={{ left: at(mate.x), top: at(mate.y) }}>
              <span
                className={`lc-bot${ready && mate.floats === true ? ' is-floating' : ''}${ready && !awake ? ' is-resting' : ''}`}
                data-bot={mate.type}
                data-state={ready ? mate.state : 'still'}
                style={{ width: size, height: size }}
              >
                {ready && mate.waiting === true && <span className="lc-bot__ring" />}
                <Bot
                  type={mate.type}
                  size={size}
                  state={ready ? mate.state : 'default'}
                  paused={!ready || !awake}
                  interactive
                  seed={0.2 + index * 0.3}
                  {...(mate.floats === true ? { jumpEvery: 0 } : {})}
                  {...(color === undefined ? {} : { color })}
                />
                {ready && mate.dot !== undefined && (
                  <span className={`lc-presence lc-presence--${mate.dot}`} style={{ width: Math.max(8, Math.round(size * 0.08)), height: Math.max(8, Math.round(size * 0.08)) }} />
                )}
              </span>
            </span>
          )
        })}
      </div>
  )
}
