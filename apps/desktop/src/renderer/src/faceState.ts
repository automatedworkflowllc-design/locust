import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * What a teammate's face is doing, and the one place it is decided.
 *
 * A face animates only while that teammate is actually doing something, and
 * the motion says WHAT: up thinks, down works, forward talks to you, sideways
 * listens. That only works if every surface -- sidebar row, workroom header,
 * the working line in the thread -- resolves the same teammate to the same
 * state at the same moment. So the state is computed here, once, from the
 * events, and every surface draws what it is handed. The first draft of this
 * feature had the header saying "responding" beside a step line saying
 * "working", for a teammate running a test suite; that is the defect this
 * file exists to make impossible.
 *
 * Idle and blocked are the only motionless states, and they must stay so for
 * the others to mean anything. Blocked is told apart from idle without motion:
 * eyes held shut and a red chip border.
 */

export type FaceActivity =
  | 'thinking'
  | 'working'
  | 'responding'
  | 'waiting'
  | 'receiving'
  | 'blocked'
  | 'done'
  | 'idle'

export interface FaceMotion {
  readonly chip?: string
  readonly eyes?: string
  readonly mouth?: string
}

/**
 * Every animation is named for the state it means. Timings from AVATARS.md.
 * `done` runs its hop once; everything else that moves loops.
 */
export const FACE_MOTION: Readonly<Record<FaceActivity, FaceMotion>> = {
  thinking: { chip: 'lcTilt 3.4s ease-in-out infinite', eyes: 'lcEyesUp 5.5s ease-in-out infinite' },
  working: { chip: 'lcBob2 2.4s ease-in-out infinite', eyes: 'lcEyesDown 3.4s ease-in-out infinite' },
  responding: {
    chip: 'lcBob 2.8s ease-in-out infinite',
    eyes: 'lcEyesFwd 5s ease-in-out infinite',
    mouth: 'lcChat 1.5s ease-in-out infinite'
  },
  waiting: { eyes: 'lcStare 6s ease-in-out infinite' },
  receiving: { eyes: 'lcGlance 2.8s ease-in-out infinite' },
  blocked: {},
  done: { chip: 'lcHop 1.2s ease-out 1' },
  idle: {}
}

/** The two states that resolve to no motion at all. Every other state moves. */
export const MOTIONLESS: readonly FaceActivity[] = ['idle', 'blocked']

export function isMotionless(activity: FaceActivity): boolean {
  const motion = FACE_MOTION[activity]
  return motion.chip === undefined && motion.eyes === undefined && motion.mouth === undefined
}

/**
 * The word beside the face. Copy follows state: a row reading "working"
 * beside a still, ringed, waiting face is the same defect as two faces
 * disagreeing, just in words.
 */
export function faceLabel(activity: FaceActivity): string {
  switch (activity) {
    case 'thinking':
      return 'thinking'
    case 'working':
      return 'working'
    case 'responding':
      return 'replying'
    case 'waiting':
      return 'waiting on you'
    case 'receiving':
      return 'listening'
    case 'blocked':
      return 'blocked'
    case 'done':
      return 'done'
    case 'idle':
      return 'idle'
  }
}

/** What a live run is doing right now, read off its events. */
export type LiveActivity = 'thinking' | 'working' | 'responding' | 'idle'

/**
 * Which of the three live states a run is in, from its event stream alone.
 * A message still streaming outranks everything -- that is the teammate
 * talking to you -- then an open reasoning step, then any open tool or turn.
 */
export function liveActivityOf(events: readonly NormalizedRuntimeEvent[], running: boolean): LiveActivity {
  if (!running) return 'idle'
  let streaming = false
  let reasoning = false
  let openTools = 0
  let turnOpen = false
  for (const event of events) {
    switch (event.type) {
      case 'message.delta':
        streaming = !event.payload.final
        break
      case 'step.started':
        if (event.payload.stepKind === 'reasoning') reasoning = true
        else if (event.payload.stepKind === 'turn') turnOpen = true
        break
      case 'step.completed':
      case 'step.failed':
        if (event.payload.stepKind === 'reasoning') reasoning = false
        else if (event.payload.stepKind === 'turn') turnOpen = false
        break
      case 'tool.started':
        openTools += 1
        reasoning = false
        break
      case 'tool.completed':
      case 'tool.failed':
        openTools = Math.max(0, openTools - 1)
        break
      default:
        break
    }
  }
  if (streaming) return 'responding'
  if (reasoning) return 'thinking'
  if (openTools > 0) return 'working'
  // A run that is live but between steps is still working: the process is
  // up and nothing has come back yet. Never idle -- idle means nobody home.
  return turnOpen || events.length === 0 ? 'working' : 'working'
}

/**
 * One teammate, one state. Precedence, highest first: blocked (nothing can
 * run), waiting on you (the state whose whole job is to get attention -- it
 * must never resolve to still), whatever their live run is doing, a hop for
 * a mission that just finished, a glance at a message that just arrived,
 * then idle.
 */
export function teammateActivity(input: {
  readonly blocked: boolean
  readonly waitingOnYou: boolean
  readonly live: LiveActivity
  readonly recentlyDone: boolean
  readonly recentlyReceived: boolean
}): FaceActivity {
  if (input.blocked) return 'blocked'
  if (input.waitingOnYou) return 'waiting'
  if (input.live !== 'idle') return input.live
  if (input.recentlyDone) return 'done'
  if (input.recentlyReceived) return 'receiving'
  return 'idle'
}

/** How long a finished mission's hop, and a received message's glance, stay on the face. */
export const DONE_HOP_MS = 1_400
export const RECEIVED_GLANCE_MS = 2_800
