import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { BotAvatarState } from 'bot-avatars'

import type { BotMood, EyeGlyphs, Glance } from './components/Bot.js'
import { watchCoverActivity } from './useCoverActivity.js'

/**
 * A FACE THAT IS ALIVE IN EVERYDAY USE (2026-10-05).
 *
 * Colin, of the screen faces' eyes: "we want the user to be able to see how
 * much versatility the eyes have, we dont want them locked behind tool calls
 * the user may never use, while also still being responsive to whatever is
 * currently happening in the session ... we want it to feel responsive but
 * not only certain animations locked behind rare events, except for the green
 * finish color change". A teammate's face said what it was doing, and when it
 * was doing nothing it was two still bars: `o o` was a face only an approval
 * or a teammate's message brought, and a person who never met either never
 * saw it. So a face at rest now answers you, and now and then is itself:
 *
 * - it LISTENS while you type to it: `o o`, its head lifted (useListening);
 * - it NOTICES your pointer: it looks at it, and a resting face squints, glad
 *   (TeammateBot);
 * - and now and then, on its own, it has a MOMENT (useIdleMoment): something
 *   catches its eye, it is content, it is curious, it dozes off and blinks
 *   awake -- the eyes it has, shown in passing, never one that says it is busy
 *   (`••`, `>▮`) or stuck, and never the green, which stays the finish's.
 *
 * Each is a change like any other (Bot's FaceChange): one blink, the new eyes
 * under it, then the body. And each keeps to the cover's rule for resting
 * (useCoverActivity, 0.623): nothing happens on its own while the window is
 * behind others, hidden, untouched for COVER_REST_AFTER_MS, or the person has
 * asked for reduced motion.
 */

/** Whether the app is awake for a face's own life: in front, shown, touched lately, motion allowed. One watch for every face. */
let awakeNow = false
const awakeListeners = new Set<() => void>()
let awakeWatch: { readonly stop: () => void } | undefined

function subscribeAwake(listener: () => void): () => void {
  awakeListeners.add(listener)
  if (awakeWatch === undefined && typeof window !== 'undefined' && typeof document !== 'undefined') {
    awakeWatch = watchCoverActivity((resting) => {
      if (awakeNow === !resting) return
      awakeNow = !resting
      for (const changed of [...awakeListeners]) changed()
    })
  }
  return () => {
    awakeListeners.delete(listener)
    if (awakeListeners.size === 0) {
      awakeWatch?.stop()
      awakeWatch = undefined
      awakeNow = false
    }
  }
}

/** Whether a face may come alive on its own just now (the cover's rule, shared by every face). */
export function useAwake(): boolean {
  return useSyncExternalStore(subscribeAwake, () => awakeNow, () => false)
}

/** How long a face keeps listening after the last key you pressed. */
export const LISTEN_HOLD_MS = 4_000

const typingListeners = new Set<() => void>()

/** A key pressed in the composer: the face you are typing to listens (useListening). Cheap: no state of the app's. */
export function noteTyping(): void {
  for (const heard of [...typingListeners]) heard()
}

/** Whether a face that `hears` the composer is listening: from a key pressed until LISTEN_HOLD_MS after the last. */
export function useListening(hears: boolean): boolean {
  const [listening, setListening] = useState(false)
  useEffect(() => {
    if (!hears) {
      setListening(false)
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const heard = (): void => {
      setListening(true)
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => setListening(false), LISTEN_HOLD_MS)
    }
    typingListeners.add(heard)
    return () => {
      typingListeners.delete(heard)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [hears])
  return hears && listening
}

/** A face's own moment at rest: the eyes it shows, how it feels, where it looks, how long it lasts. */
export interface IdleMoment {
  /** One of IDLE_MOMENTS' four, or a pet's own (petRoutines.ts: a short set of a lift). */
  readonly name: string
  readonly eyes: EyeGlyphs
  readonly mood?: BotMood
  /** Its rig's state for the moment: a doze is the rig's own sleep. */
  readonly state?: BotAvatarState
  /** Something to the side catches its eye (BotProps.glance). */
  readonly glance?: Glance
  readonly seconds: number
}

/**
 * The moments, each a face a teammate already has: wide eyes as something
 * catches them (looking to one side), a happy squint, a curious tip of the
 * head, a doze. Not the thinking dots or the prompt, which say it is busy; not
 * `> <`, which says it is stuck; never the green flash.
 */
export const IDLE_MOMENTS: readonly IdleMoment[] = [
  { name: 'look', eyes: ['o', 'o'], glance: { x: 1, y: -0.35 }, seconds: 1.8 },
  { name: 'content', eyes: ['^', '^'], mood: 'glad', seconds: 1.6 },
  { name: 'curious', eyes: ['o', 'o'], mood: 'curious', seconds: 2 },
  { name: 'doze', eyes: ['c', 'c'], state: 'sleeping', seconds: 2.6 }
]

/** Seconds between a face's moments, at least and at most: the face you talk to more often, the rest rarely. */
export const MOMENT_EVERY: Readonly<Record<'full' | 'subtle', readonly [number, number]>> = {
  full: [7, 14],
  subtle: [18, 36]
}

/** 0 to 1 from a face's seed and a count: the same face makes the same choices, and no two faces the same ones. */
export function seeded(seed: number, count: number, salt = 0): number {
  let hash = Math.floor(seed * 4294967296) ^ Math.imul(count + 1, 2654435761) ^ Math.imul(salt + 7, 40503)
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

/** A face's `count`th moment: chosen by its seed, never the one it had last, a look to whichever side it picks. */
export function momentFor(seed: number, count: number, last: string | undefined): IdleMoment {
  const choices = IDLE_MOMENTS.filter((moment) => moment.name !== last)
  const chosen = choices[Math.floor(seeded(seed, count, 1) * choices.length)] ?? IDLE_MOMENTS[0]
  if (chosen === undefined || chosen.glance === undefined) return chosen ?? { name: 'content', eyes: ['^', '^'], mood: 'glad', seconds: 1.6 }
  return { ...chosen, glance: { ...chosen.glance, x: seeded(seed, count, 2) < 0.5 ? -1 : 1 } }
}

/** How a face picks its `count`th moment, given the last it had: momentFor, or a pet's own (petRoutines.ts's buddyMoment). */
export type MomentPick = (seed: number, count: number, last: string | undefined) => IdleMoment

/**
 * The moment a resting face is having now, or undefined: one now and then,
 * `every` seconds apart give or take, while `enabled` and the app is awake
 * (useAwake). The first comes a gap after the face is at rest, never as it
 * gets there. `pick` chooses each (read when it is chosen).
 */
export function useIdleMoment(enabled: boolean, seed: number, every: readonly [number, number], pick: MomentPick = momentFor): IdleMoment | undefined {
  const awake = useAwake()
  const [moment, setMoment] = useState<IdleMoment | undefined>(undefined)
  const count = useRef(0)
  const last = useRef<string | undefined>(undefined)
  const picking = useRef(pick)
  picking.current = pick
  const [least, most] = every
  useEffect(() => {
    if (!enabled || !awake) {
      setMoment(undefined)
      return undefined
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = (): void => {
      const at = count.current
      timer = setTimeout(
        () => {
          const chosen = picking.current(seed, at, last.current)
          count.current = at + 1
          last.current = chosen.name
          setMoment(chosen)
          timer = setTimeout(() => {
            setMoment(undefined)
            next()
          }, chosen.seconds * 1000)
        },
        (least + (most - least) * seeded(seed, at)) * 1000
      )
    }
    next()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      setMoment(undefined)
    }
  }, [enabled, awake, seed, least, most])
  return enabled && awake ? moment : undefined
}
