import type { ReactElement } from 'react'
import type { BotAvatarState } from 'bot-avatars'

import { botFor } from '../../../shared/avatar.js'
import type { FaceActivity } from '../faceState.js'
import { Bot } from './Bot.js'
import { PRESENCE_TONE } from './PixelFace.js'
import type { PixelFaceProps } from './PixelFace.js'

/**
 * A TEAMMATE, AS A BOT -- the face every surface draws since 0.277.
 *
 * Colin, 2026-09-22: *"we're going to have to make miniature versions of the
 * little bots for our sidebar as well and chat as well and teammate picker
 * panel"*. This takes exactly the pixel face's props, so each of its call
 * sites -- the sidebar row, a face in the thread, the teammate card, the
 * picker -- swaps without changing what it says. The same hooks stay on the
 * element (`lc-face`, `data-activity`, `data-teammate`, the name as the
 * accessible label where the face stands in for it), and Locust's own marks
 * stay on the body: the presence dot, and the amber ring of a teammate
 * waiting on you.
 *
 * The shape and the face come from the teammate's avatar (`botFor`): the one
 * they picked, or the one their seeded look maps to. The colour is their
 * hue's token, read off the page once.
 */

/**
 * HOW MUCH A BOT MOVES, BY WHERE IT STANDS.
 *
 * Colin, 2026-09-23, with a frame of the sidebar and the workroom header both
 * hopping the same working teammate: *"these two bot versions have the same
 * amount of movement as the one in the chat and its a bit distracting ...
 * besides the one in the chat just give them a slight bounce or look around,
 * the one in the chat can remain as is"*, and then, to be sure: *"the one in
 * the chat where you're speaking to, all that movement is fine and great ...
 * but its mirrored in the sidebar and the top, lets tame those two down"*.
 *
 * So there are two levels. `full` is the whole performance -- a working
 * teammate hops, and one looking around flips now and then -- and it is kept
 * for the face beside the thread's live line, the one you are talking to
 * (and the New teammate preview, which exists to show that performance).
 * Everywhere else is `subtle`, the default: a working teammate looks around
 * and bounces a little, nobody flips, and nothing hops.
 */
export type BotMotionLevel = 'full' | 'subtle'

export interface BotMotion {
  readonly state: BotAvatarState
  /** Still, in the state's resting pose. */
  readonly paused: boolean
  /** Seconds between the library's idle flips; 0 for none. Absent: the library's own. */
  readonly jumpEvery?: number
  /** The slight bounce (shell.css) a subtle bot does where a full one hops. */
  readonly bounces: boolean
}

/**
 * Only work moves. Colin, on whether an idle bot should sleep or keep still:
 * *"ill run with your suggestion"* -- still, everywhere but the title screen.
 * Working and delegating are work; a teammate thinking, answering, receiving
 * or waiting on you is alive and looks around; idle, blocked and done keep
 * their resting pose.
 */
function kindOf(activity: FaceActivity): 'work' | 'alive' | 'still' {
  switch (activity) {
    case 'working':
    case 'delegating':
      return 'work'
    case 'thinking':
    case 'responding':
    case 'receiving':
    case 'waiting':
      return 'alive'
    case 'blocked':
    case 'done':
    case 'idle':
      return 'still'
  }
}

export function botMotion(activity: FaceActivity, level: BotMotionLevel = 'subtle'): BotMotion {
  const kind = kindOf(activity)
  if (level === 'full') return { state: kind === 'work' ? 'working' : 'default', paused: kind === 'still', bounces: false }
  return { state: 'default', paused: kind === 'still', jumpEvery: 0, bounces: kind === 'work' }
}

const hueColors = new Map<string, string | undefined>()

/** A hue's token as a colour a canvas can take; tokens do not change while the app runs. */
function hueColor(hue: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  if (!hueColors.has(hue)) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--lc-hue-${hue}`).trim()
    hueColors.set(hue, value.length === 0 ? undefined : value)
  }
  return hueColors.get(hue)
}

/** 0-1 from an id, so a row of teammates does not blink in unison. */
function seedOf(text: string): number {
  let hash = 2166136261
  for (const character of text) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

export interface TeammateBotProps extends PixelFaceProps {
  /** How much it moves: `subtle` unless this is the face you are talking to. */
  readonly motion?: BotMotionLevel
}

export function TeammateBot({
  hue,
  avatar,
  size = 32,
  activity = 'idle',
  presence = 'none',
  className,
  teammateId,
  name,
  motion = 'subtle'
}: TeammateBotProps): ReactElement {
  const bot = botFor(avatar)
  const { state, paused, jumpEvery, bounces } = botMotion(activity, motion)
  const color = hueColor(hue)
  const tone = PRESENCE_TONE[presence]
  return (
    <span
      className={`lc-face lc-bot${bounces ? ' is-bouncing' : ''}${className === undefined ? '' : ` ${className}`}`}
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      {...(name === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name, title: name })}
      data-activity={activity}
      data-bot={bot.shape}
      data-motion={motion}
      {...(teammateId === undefined ? {} : { 'data-teammate': teammateId })}
    >
      {activity === 'waiting' && <span className="lc-bot__ring" />}
      <Bot
        type={bot.shape}
        size={size}
        state={state}
        paused={paused}
        face={bot.face}
        seed={seedOf(teammateId ?? name ?? bot.shape)}
        {...(color === undefined ? {} : { color })}
        {...(jumpEvery === undefined ? {} : { jumpEvery })}
      />
      {tone !== undefined && <span className={`lc-presence lc-presence--${tone}`} />}
    </span>
  )
}
