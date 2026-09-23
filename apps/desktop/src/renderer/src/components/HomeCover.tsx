import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

import type { BotAvatarState } from 'bot-avatars'

import type { TeammateHue, TubePreference } from '../../../shared/ipc.js'
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
export const COVER_HEIGHT = 288

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
  { key: 'wren', type: 'ghost', state: 'default', floats: true, dot: 'lime', x: 536, y: 76 },
  { key: 'atlas', type: 'droid', hue: 'blue', state: 'default', dot: 'amber', waiting: true, x: 680, y: 100 },
  { key: 'sable', type: 'hopper', hue: 'lime', state: 'sleeping', x: 824, y: 64 }
]

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
      {COVER_CAST.map((mate, index) => {
        const size = at(FACE)
        const color = mate.hue === undefined ? undefined : hueColor(mate.hue)
        return (
          <span key={mate.key} className="lc-cover__face" style={{ left: at(mate.x), top: at(mate.y) }}>
            <span
              className={`lc-bot${ready && mate.floats === true ? ' is-floating' : ''}`}
              data-bot={mate.type}
              data-state={ready ? mate.state : 'still'}
              style={{ width: size, height: size }}
            >
              {ready && mate.waiting === true && <span className="lc-bot__ring" />}
              <Bot
                type={mate.type}
                size={size}
                state={ready ? mate.state : 'default'}
                paused={!ready}
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
      <div className="lc-cover__brand">
        <PoweredLockup ready={ready} tube={tube} />
        <p className="lc-cover__claim">Autonomous teammates on your own machine</p>
      </div>
    </div>
  )
}
