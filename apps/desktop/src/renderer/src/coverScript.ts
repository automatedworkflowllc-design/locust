import type { EyeGlyphs, Phosphor } from './components/Bot.js'

/**
 * THE TITLE SCREEN'S THREE, EACH WITH A LIFE OF ITS OWN (0.562).
 *
 * Colin, 2026-10-03: "for our splash screen its a bit sloppier now, maybe use
 * ghost, the codex looking one and our locust but make it so some of them
 * have different terminal eyes its just all the same sloppy set, we
 * definitely need a design pass on this whole thing, give real effort into
 * making this production quality". With Terminal faces on, all three wore the
 * same resting bars and did nothing with them. Now each has a part, played on
 * its own loop so the three are never in step:
 *
 * - THE WORKER, Prompt (the Codex nod): types in bursts, finishes -- green
 *   carets and a hop -- looks over at the ghost, waits on you a moment in
 *   Locust's amber (the ring, the dot, amber eyes), and gets back to it.
 * - THE THINKER, the ghost: round eyes looking up and about, then the two-dot
 *   loader; an idea (green carets); a look across at the worker; back to
 *   thinking. It floats, so it never hops.
 * - THE SLEEPER, our locust: asleep with closed eyes and a drift of z's until
 *   a pointer comes near (HomeCover's `hopperWakes`); awake, it watches the
 *   pointer with resting bars, and a click gets a hop and green carets.
 *
 * Every beat is a state a teammate really shows in the app, in the colours it
 * really uses (PHOSPHOR), so the title screen teaches the faces as it plays.
 */

export interface CoverBeat {
  /** Names the beat, so a change of beat can be told from a repeat. */
  readonly name: string
  readonly seconds: number
  /** Undefined: a screen's resting bars. */
  readonly eyes?: EyeGlyphs
  readonly phosphor: Phosphor
  /** Hops once as the beat starts. */
  readonly hop?: true
  /** Looks this way for the beat's first moments (Bot's GLANCE_HOLD_MS). */
  readonly glance?: 'left' | 'right'
  /** Locust's waiting-on-you marks: the amber ring, and the dot gone amber. */
  readonly waiting?: true
}

export const WORKER: readonly CoverBeat[] = [
  { name: 'typing', seconds: 6.5, eyes: ['>', '▮'], phosphor: 'cyan' },
  { name: 'done', seconds: 1.8, eyes: ['^', '^'], phosphor: 'green', hop: true },
  { name: 'looks-over', seconds: 1.7, phosphor: 'cyan', glance: 'left' },
  { name: 'waiting', seconds: 3.2, phosphor: 'amber', waiting: true },
  { name: 'back-to-it', seconds: 3.8, eyes: ['>', '▮'], phosphor: 'cyan' }
]

export const THINKER: readonly CoverBeat[] = [
  { name: 'thinking', seconds: 5.5, eyes: ['•', '•'], phosphor: 'cyan' },
  { name: 'idea', seconds: 1.6, eyes: ['^', '^'], phosphor: 'green' },
  { name: 'looks-across', seconds: 2.4, phosphor: 'cyan', glance: 'right' },
  { name: 'thinking-again', seconds: 3.5, eyes: ['•', '•'], phosphor: 'cyan' }
]

export const SLEEPING: CoverBeat = { name: 'asleep', seconds: Number.POSITIVE_INFINITY, eyes: ['c', 'c'], phosphor: 'cyan' }
export const WATCHING: CoverBeat = { name: 'watching', seconds: Number.POSITIVE_INFINITY, phosphor: 'cyan' }
export const PLEASED: CoverBeat = { name: 'pleased', seconds: 1.5, eyes: ['^', '^'], phosphor: 'green', hop: true }

/** How long a loop of beats takes. */
export function loopSeconds(beats: readonly CoverBeat[]): number {
  return beats.reduce((sum, beat) => sum + beat.seconds, 0)
}

/** Where the worker and the thinker start in their loops, so the three are never in step. */
export const WORKER_OFFSET = 0
export const THINKER_OFFSET = 4.1

/**
 * The beat a loop is on `elapsed` seconds in, and how long until the next one
 * -- the cover sleeps until then rather than ticking.
 */
export function beatAt(beats: readonly CoverBeat[], elapsed: number): { readonly beat: CoverBeat; readonly index: number; readonly left: number } {
  const period = loopSeconds(beats)
  let into = ((elapsed % period) + period) % period
  for (const [index, beat] of beats.entries()) {
    if (into < beat.seconds) return { beat, index, left: beat.seconds - into }
    into -= beat.seconds
  }
  const last = beats.length - 1
  return { beat: beats[last] as CoverBeat, index: last, left: 0.001 }
}

/**
 * What a still title screen shows -- reduced motion, or before the runtimes
 * have answered: each at its most telling beat, one frame.
 */
export const STILL_WORKER: CoverBeat = WORKER[0] as CoverBeat
export const STILL_THINKER: CoverBeat = THINKER[0] as CoverBeat
