import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { BotAvatarState } from 'bot-avatars'

import { botFor } from '../../../shared/avatar.js'
import { useTerminalFaces } from '../botLook.js'
import { MOMENT_EVERY, WORKING_LEAD, crtRule, useIdleMoment, useListening, workingBeatFor } from '../faceLife.js'
import type { IdleMoment } from '../faceLife.js'
import type { FaceActivity } from '../faceState.js'
import type { GlanceSide } from '../glances.js'
import { petStateFor } from '../petMotion.js'
import { routineFor } from '../petRoutines.js'
import { usePetLook } from '../pets.js'
import { Bot } from './Bot.js'
import type { BotMood, EyeGlyphs, Glance, Phosphor } from './Bot.js'
import { PetPuppet } from './PetPuppet.js'
import { PetSprite } from './PetSprite.js'
import { PRESENCE_TONE } from './PixelFace.js'
import { RuntimeMark } from './RuntimeMark.js'
import type { PixelFaceProps } from './PixelFace.js'
import type { WindowPresence } from '../windowPresence.js'

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
  /** One hop, straight up, now: a turn just finished. */
  readonly hops: boolean
}

/**
 * Only work moves. Colin, on whether an idle bot should sleep or keep still:
 * *"ill run with your suggestion"* -- still, everywhere but the title screen.
 * Working and delegating are work; a teammate thinking, answering, receiving
 * or waiting on you is alive and looks around; idle and blocked keep their
 * resting pose.
 *
 * AND A TEAMMATE THAT JUST FINISHED HOPS, ONCE. The pixel faces did (`done`
 * ran `lcHop` once); the bots that replaced them kept still, so the one
 * thing a glance at the sidebar used to say -- who just finished -- went.
 * Colin, 2026-09-23, of "a hop when a teammate finishes": *"you can run all
 * those"*. The library's jump with no turn in it, at either level: a moment,
 * not a performance, so it is the same size everywhere.
 */
/**
 * Whether a teammate is at work: its run live, whatever it is doing this
 * second. Its face then wears the working face and goes round the rest
 * (faceLife.ts's WORKING_BEATS); the word beside it says what the run is doing.
 */
export function atWork(activity: FaceActivity): boolean {
  return activity === 'thinking' || activity === 'working' || activity === 'delegating' || activity === 'responding'
}

/** The state a face wears for what its teammate is doing: at work, the working face; otherwise what it is doing. */
export function wornActivity(activity: FaceActivity): FaceActivity {
  return atWork(activity) ? 'working' : activity
}

function kindOf(activity: FaceActivity): 'work' | 'alive' | 'finished' | 'still' {
  switch (activity) {
    case 'working':
    case 'delegating':
      return 'work'
    case 'thinking':
    case 'responding':
    case 'receiving':
    case 'waiting':
      return 'alive'
    case 'done':
      return 'finished'
    case 'blocked':
    case 'idle':
      return 'still'
  }
}

export function botMotion(activity: FaceActivity, level: BotMotionLevel = 'subtle'): BotMotion {
  const kind = kindOf(activity)
  if (kind === 'finished') return { state: 'default', paused: false, jumpEvery: 0, bounces: false, hops: true }
  // A face that keeps still never flips when something wakes it -- a glance, you, a moment of its own (faceLife.ts).
  if (level === 'full') return { state: kind === 'work' ? 'working' : 'default', paused: kind === 'still', ...(kind === 'still' ? { jumpEvery: 0 } : {}), bounces: false, hops: false }
  return { state: 'default', paused: kind === 'still', jumpEvery: 0, bounces: kind === 'work', hops: false }
}

/** Where a glance points, for each side a teammate can be on. */
const GLANCE_TOWARD: Readonly<Record<GlanceSide, Glance>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 }
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
  /**
   * Hops when the teammate finishes. The workroom header says no: it sits
   * over the reply you are already reading, and Colin asked for it, with the
   * sidebar, to be calmer than the face you talk to (0.279).
   */
  readonly hopsWhenDone?: boolean
  /**
   * Looks this way for a moment: toward a teammate it just handed a message
   * to, or that just handed it one (glances.ts). Wakes a still bot for it.
   */
  readonly glance?: GlanceSide
  /**
   * The runtime this teammate runs on, worn as a small mark on the body's
   * lower left, opposite the presence dot (0.383). For a face that stands
   * without its route in words beside it -- the sidebar's row of faces --
   * so which model is who reads at a glance. Drawn only where the face is
   * big enough for the mark to be a mark.
   */
  readonly runtime?: string
  /**
   * Listens while you type in the composer (faceLife.ts's useListening): the
   * face of the conversation you are typing in, and no other.
   */
  readonly hears?: boolean
  /** When its clock rests, where a surface rests by a rule of its own (Bot's motionPresence): the window's, otherwise. */
  readonly motionPresence?: WindowPresence
}

/**
 * EYES THAT SAY WHAT IT IS DOING (0.559). Colin, 2026-10-02: "I kind of like
 * what the codex mascot does with the eyes making them different coding
 * lines. Should we implement that to all of our teammates?" Every teammate:
 * a prompt while it works, dashes while it thinks, carets when it is done,
 * crosses when it is stuck. Waiting on you keeps its own eyes and the amber
 * ring; talking, listening and idle keep the rig's eyes, which move.
 *
 * ALERT, NOT FLAT (0.561). Colin, 2026-10-03: "thinking and working should
 * have animations where the teammate looks alert, not flat lines" -- "you can
 * even cycle dots in there on the screen, just anything but flat lines". At
 * work the prompt's cursor is a solid block, not an underscore; in thought the
 * eyes are round and wide open, looking up and about, then bouncing in turn
 * like a reply being typed (Bot.tsx glyphMotion).
 *
 * A SCREEN SPEAKS ASCII (2026-10-05). Colin, of the terminal eyes: "i was
 * referring to the terminal eye text themselves being/involving ascii". The
 * glyphs always were ASCII, drawn rather than typed (0.560); now they make the
 * faces a terminal makes. Waiting on you it looks at you, `o o` -- the amber
 * ring alone said it before, and now the face does too, its head tipped
 * (BotMood). A message just in, the same wide eyes for the moment. Stuck is
 * `> <`, the face of trying: crosses read as dead more than stuck.
 *
 * AND IT LOOKS AT YOU AS IT TALKS (2026-10-05). Colin: "we want the user to be
 * able to see how much versatility the eyes have, we dont want them locked
 * behind tool calls the user may never use". Answering you, a teammate's
 * screen showed the resting bars, the one face it had that said nothing; and
 * `o o` came only with an approval or a teammate's message. Now its eyes are
 * on you while its reply comes in, as they are while you type to it
 * (faceLife.ts): every exchange shows the faces it has.
 */
export function eyeGlyphsFor(activity: FaceActivity): EyeGlyphs | undefined {
  switch (activity) {
    case 'working':
    case 'delegating':
      return ['>', '▮']
    case 'thinking':
      return ['•', '•']
    case 'done':
      return ['^', '^']
    case 'blocked':
      return ['>', '<']
    case 'waiting':
    case 'receiving':
    case 'responding':
      return ['o', 'o']
    default:
      return undefined
  }
}

/**
 * What a screen's eyes glow for each state (0.562): the terminal's cyan while
 * it works, thinks or idles; amber while it waits on you (the ring's amber),
 * red when it is stuck. See PHOSPHOR in Bot.tsx.
 *
 * DONE IS WHITE, WITH A GREEN FLASH (2026-10-05). Colin: "dont make the eye
 * color lime please just white, if you want work that into a color change
 * flash or something you can but not the entire static color". A finished
 * teammate's eyes stay the screen's own light; the green comes as it
 * finishes and fades back (flashFor, Bot's FLASH_S).
 */
export function phosphorFor(activity: FaceActivity): Phosphor {
  switch (activity) {
    case 'waiting':
      return 'amber'
    case 'blocked':
      return 'red'
    default:
      return 'cyan'
  }
}

/** A colour a screen's eyes flash as a state arrives, fading to their own: green as it finishes. */
export function flashFor(activity: FaceActivity): Phosphor | undefined {
  return activity === 'done' ? 'green' : undefined
}


/**
 * HOW IT FEELS, FOR WHAT IT IS DOING (2026-10-05, see BotMood). Waiting on
 * you, the head tips to one side, curious; a message just in, it perks up;
 * just finished, it smiles as it hops. The rest is said by its motion.
 */
export function moodFor(activity: FaceActivity): BotMood | undefined {
  switch (activity) {
    case 'waiting':
      return 'curious'
    case 'receiving':
      return 'perked'
    case 'done':
      return 'glad'
    default:
      return undefined
  }
}

/** Below this a badge is a speck: the mark is not drawn. */
export const MARKED_FACE_MIN = 24

/**
 * From this size a face is a PRESENCE, the teammate itself (botSizes.ts):
 * it notices you and has its moments. Below it, a mark beside a name, it
 * keeps to saying who.
 */
export const PRESENCE_MIN = 28

/** How long a pointer rests on a face before the face notices it: a pass across a list is not a visit. */
export const NOTICE_DWELL_MS = 220

/** What a face shows this moment, with the everyday life of a face at rest worn over what it is doing. */
export interface EverydayFace {
  readonly eyes: EyeGlyphs | undefined
  readonly mood: BotMood | undefined
  /** What it is doing, as a change it performs (Bot's blinkKey). */
  readonly key: string
  /** Its rig's state for the moment, where that is not its activity's. */
  readonly state?: BotAvatarState
  /** Where it looks for the moment (Bot's glance). */
  readonly glance?: Glance
  /** Moving though its activity would keep it still: it is answering you, or having a moment. */
  readonly lively: boolean
}

/**
 * A FACE AT REST ANSWERS YOU (2026-10-05, faceLife.ts). What a teammate is
 * doing always wins: busy, stuck, waiting or done, it says so, and a pointer
 * on it only turns its head to you. At rest, it answers you before anything
 * of its own: pointed at, it is glad (`^ ^`, a smile on plastic, cyan: the
 * green is the finish's); typed to, it listens (`o o`, its head lifted); and
 * otherwise, now and then, it has a moment of its own (IDLE_MOMENTS).
 */
export function everydayFace(
  activity: FaceActivity,
  life: { readonly noticed: boolean; readonly listening: boolean; readonly moment: IdleMoment | undefined; readonly beat?: IdleMoment | undefined }
): EverydayFace {
  const own: EverydayFace = { eyes: eyeGlyphsFor(activity), mood: moodFor(activity), key: activity, lively: false }
  // At work, a beat of another face (faceLife.ts's WORKING_BEATS), its body easing off the hop for it.
  const beat = life.beat
  if (activity === 'working' && beat !== undefined && !life.noticed) {
    return {
      eyes: beat.eyes,
      mood: beat.mood,
      key: `working:${beat.name}`,
      state: 'default',
      ...(beat.glance === undefined ? {} : { glance: beat.glance }),
      lively: false
    }
  }
  if (activity !== 'idle') return life.noticed ? { ...own, lively: true } : own
  if (life.noticed) return { eyes: ['^', '^'], mood: 'glad', key: 'idle:noticed', lively: true }
  if (life.listening) return { eyes: ['o', 'o'], mood: 'perked', key: 'idle:listening', lively: true }
  const moment = life.moment
  if (moment === undefined) return own
  return {
    eyes: moment.eyes,
    mood: moment.mood,
    key: `idle:${moment.name}`,
    ...(moment.state === undefined ? {} : { state: moment.state }),
    ...(moment.glance === undefined ? {} : { glance: moment.glance }),
    lively: true
  }
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
  motion = 'subtle',
  hopsWhenDone = true,
  glance,
  runtime,
  hears = false,
  motionPresence
}: TeammateBotProps): ReactElement {
  const bot = botFor(avatar)
  const shownActivity = activity === 'done' && !hopsWhenDone ? 'idle' : activity
  // At work, whatever its run is doing this second, a face wears the working face and goes round the rest (faceLife.ts's WORKING_BEATS).
  const worn = wornActivity(shownActivity)
  const { state, paused, jumpEvery, bounces, hops } = botMotion(worn, motion)
  const color = hueColor(hue)
  const tone = PRESENCE_TONE[presence]
  const seed = seedOf(teammateId ?? name ?? bot.shape)
  const presenceSized = size >= PRESENCE_MIN
  // A pointer resting on the face (NOTICE_DWELL_MS): it notices you.
  const [noticed, setNoticed] = useState(false)
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      if (dwell.current !== undefined) clearTimeout(dwell.current)
    },
    []
  )
  // The dot pops when its colour changes -- someone starts waiting on you -- never as a face first appears.
  const dotTone = useRef(tone)
  const dotChanged = useRef(false)
  if (dotTone.current !== tone) {
    dotTone.current = tone
    dotChanged.current = true
  }
  /*
   * A PET FOR A FACE (0.563): in the bot's box, with the bot's ring, dot and
   * mark -- "these should be the exact same as teammates". No bounce: a pet's
   * own drawings are its motion. A pet that cannot be drawn -- its file gone
   * or unreadable -- shows the bot instead, never an empty box.
   *
   * Code eyes stayed the bots' own (*"the new eyes will have to be isolated to
   * our current sprites"*) -- until a pet's drawings were measured for a
   * screen (2026-10-05, petScreens.ts): Codex Buddy. While Terminal faces is
   * on, he wears one unless his teammate's look says as drawn (PetRef.screen),
   * with a bot's eyes and their changes, a bot's everyday life at rest, and
   * his own moves for each (petRoutines.ts). The other pets Colin kept are
   * puppets on a bot's rig (petPuppets.ts): a teammate wearing one lives as a
   * bot does, its moods, hops and glances, a screen with a bot's eyes on its face.
   */
  const pet = avatar.pet
  const petNow = usePetLook(pet)
  const wearsPet = pet !== undefined && petNow?.status !== 'missing'
  const terminal = useTerminalFaces()
  const atlas = petNow?.status === 'ready' ? petNow.atlas : undefined
  const screened = wearsPet && terminal && pet.screen !== false
  const routine = screened && atlas?.screen !== undefined ? routineFor(pet.id) : undefined
  const puppet = screened && routine === undefined ? atlas?.puppet : undefined
  // Its everyday life (faceLife.ts): a bot's, and a screen-faced pet's; any other pet's own rows are its motion.
  const answers = !wearsPet || routine !== undefined || puppet !== undefined
  const atRest = shownActivity === 'idle' && answers
  const listening = useListening(hears && atRest)
  const moment = useIdleMoment(atRest && presenceSized && !noticed && !listening, seed, MOMENT_EVERY[motion], routine?.moment)
  // At work, a beat of another face now and then, the lead between (WORKING_LEAD): only where a face is a presence, and pointed at it looks at you instead.
  const beat = useIdleMoment(worn === 'working' && answers && presenceSized && !noticed, seed, WORKING_LEAD[motion], workingBeatFor)
  const face = everydayFace(worn, { noticed: noticed && answers, listening, moment, beat })
  // Which of its changes come in as its screen switching on again (faceLife.ts's crtRule).
  const crt = useMemo(() => crtRule(seed), [seed])
  const notice = (on: boolean): void => {
    if (dwell.current !== undefined) clearTimeout(dwell.current)
    dwell.current = undefined
    if (!on) setNoticed(false)
    else dwell.current = setTimeout(() => setNoticed(true), NOTICE_DWELL_MS)
  }
  return (
    <span
      className={`lc-face lc-bot${bounces && beat === undefined && (!wearsPet || puppet !== undefined) ? ' is-bouncing' : ''}${className === undefined ? '' : ` ${className}`}`}
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}
      {...(name === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name, title: name })}
      data-activity={activity}
      data-bot={bot.shape}
      {...(wearsPet ? { 'data-pet': pet.id } : {})}
      data-motion={motion}
      {...(teammateId === undefined ? {} : { 'data-teammate': teammateId })}
      {...(face.key === worn ? {} : { 'data-life': face.key })}
      {...(presenceSized && answers ? { onPointerEnter: () => notice(true), onPointerLeave: () => notice(false) } : {})}
    >
      {activity === 'waiting' && <span className="lc-bot__ring" />}
      {wearsPet && puppet !== undefined && atlas !== undefined ? (
        <PetPuppet
          pet={pet}
          atlas={atlas}
          puppet={puppet}
          size={size}
          atTheSide={motion !== 'full'}
          petState={petStateFor(shownActivity)}
          state={face.state ?? state}
          paused={paused && glance === undefined && !face.lively}
          seed={seed}
          hop={hops}
          follows={noticed}
          {...(motionPresence === undefined ? {} : { motionPresence })}
          {...(face.eyes === undefined ? {} : { eyes: face.eyes })}
          {...(face.mood === undefined ? {} : { mood: face.mood })}
          blinkKey={face.key}
          crt={crt}
          {...((teammateId ?? name) === undefined ? {} : { bootKey: teammateId ?? name })}
          phosphor={phosphorFor(worn)}
          {...(flashFor(worn) === undefined ? {} : { flash: flashFor(worn) })}
          {...(glance !== undefined ? { glance: GLANCE_TOWARD[glance] } : face.glance === undefined ? {} : { glance: face.glance })}
          {...(jumpEvery === undefined ? {} : { jumpEvery })}
        />
      ) : wearsPet ? (
        <PetSprite
          pet={pet}
          size={size}
          state={petStateFor(shownActivity)}
          atTheSide={motion !== 'full'}
          {...(glance === undefined ? {} : { glance })}
          {...(routine === undefined
            ? {}
            : {
                screen: {
                  eyes: face.eyes,
                  phosphor: phosphorFor(worn),
                  ...(flashFor(worn) === undefined ? {} : { flash: flashFor(worn) }),
                  key: face.key,
                  move: routine.moveFor(face.key, face.glance?.x, motion),
                  rests: paused && glance === undefined && !face.lively,
                  crt
                },
                seed,
                ...((teammateId ?? name) === undefined ? {} : { bootKey: teammateId ?? name }),
                ...(motionPresence === undefined ? {} : { motionPresence })
              })}
        />
      ) : (
        <Bot
          type={bot.shape}
          size={size}
          // A face beside a name draws at half the beat; the one you talk to at the whole (frameBeat.ts, 0.670).
          atTheSide={motion !== 'full'}
          state={face.state ?? state}
          paused={paused && glance === undefined && !face.lively}
          face={bot.face}
          seed={seed}
          hop={hops}
          follows={noticed}
          {...(motionPresence === undefined ? {} : { motionPresence })}
          {...(face.eyes === undefined ? {} : { eyes: face.eyes })}
          {...(face.mood === undefined ? {} : { mood: face.mood })}
          blinkKey={face.key}
          crt={crt}
          {...(teammateId ?? name) === undefined ? {} : { bootKey: teammateId ?? name }}
          {...(bot.screen === undefined ? {} : { screen: bot.screen })}
          phosphor={phosphorFor(worn)}
          {...(flashFor(worn) === undefined ? {} : { flash: flashFor(worn) })}
          {...(glance !== undefined ? { glance: GLANCE_TOWARD[glance] } : face.glance === undefined ? {} : { glance: face.glance })}
          {...(color === undefined ? {} : { color })}
          {...(jumpEvery === undefined ? {} : { jumpEvery })}
        />
      )}
      {/* Keyed by its tone, so a dot that changes colour is a new dot, and pops in (shell.css, lcPresencePop). */}
      {tone !== undefined && <span key={tone} className={`lc-presence lc-presence--${tone}${dotChanged.current ? ' is-new' : ''}`} />}
      {runtime !== undefined && size >= MARKED_FACE_MIN && (
        <span className="lc-bot__mark" data-runtime={runtime}>
          <RuntimeMark runtime={runtime} size={Math.round(size * 0.24)} />
        </span>
      )}
    </span>
  )
}
