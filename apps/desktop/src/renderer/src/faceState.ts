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
  | 'delegating'
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
  // Waiting on a subagent of its own: the same motion as working, a
  // different word (Colin, 2026-09-05: "make it say subagent working").
  delegating: { chip: 'lcBob2 2.4s ease-in-out infinite', eyes: 'lcEyesDown 3.4s ease-in-out infinite' },
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
    case 'delegating':
      return 'subagent working'
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
export type LiveActivity = 'thinking' | 'working' | 'delegating' | 'responding' | 'idle'

/** A runtime's own subagent launcher: Claude Code's Agent (Task before 2.x), OpenCode's task. */
export const SUBAGENT_TOOL = /^(task|agent|subagent|spawn_agent|subagent:\w+)$/i

/**
 * Which of the three live states a run is in, from its event stream alone.
 * A message still streaming outranks everything -- that is the teammate
 * talking to you -- then an open reasoning step, then any open tool or turn.
 */
export function liveActivityOf(events: readonly NormalizedRuntimeEvent[], running: boolean): LiveActivity {
  if (!running) return 'idle'
  let streaming = false
  let reasoning = false
  // By item, not by count: Claude Code restates a tool's start once its
  // input arrives, and counting both left every finished call open (M23).
  const openTools = new Set<string>()
  const openSubagents = new Set<string>()
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
        openTools.add(event.payload.itemId)
        if (SUBAGENT_TOOL.test(event.payload.name)) openSubagents.add(event.payload.itemId)
        reasoning = false
        break
      case 'tool.completed':
      case 'tool.failed':
        openTools.delete(event.payload.itemId)
        openSubagents.delete(event.payload.itemId)
        break
      default:
        break
    }
  }
  if (streaming) return 'responding'
  if (reasoning) return 'thinking'
  if (openSubagents.size > 0) return 'delegating'
  if (openTools.size > 0) return 'working'
  // An open TURN step is the runtime naming something it is doing, and the
  // thread draws that as a named live line with no dots. It has to resolve to
  // `working` for the same reason the gap below resolves to `thinking`: the
  // face and the dots must agree, and here there are no dots.
  if (turnOpen) return 'working'
  // Live, but with nothing open: no tool running, no message arriving, no
  // reasoning step reported. The run is waiting on the model.
  //
  // This used to answer `working`, chosen against `idle` -- the process IS up,
  // and idle means nobody home. But the app has no evidence of WORK here, only
  // of waiting, and the difference became visible when the waiting line
  // started showing the dots on 2026-09-05: a bobbing "working" face beside
  // staggered "still thinking" dots, which the avatar spec forbids for a good
  // reason. They say opposite things.
  //
  // `thinking` is the same fact under a truer name, and it is already the
  // vocabulary for "waiting on thought, nothing to show". It keeps every chip
  // agreeing -- sidebar, header and the working line all resolve here -- and
  // it is what a person is actually waiting on.
  return 'thinking'
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

/**
 * How long a finished mission's hop, and a received message's glance, stay on
 * the face. The hop is the bot library's jump, about 1.5 s from the crouch to
 * its own shape again (Bot.tsx's HOP_MS), so the moment outlasts it: a bot
 * stilled before it lands is snapped out of the air.
 */
export const DONE_HOP_MS = 1_800
export const RECEIVED_GLANCE_MS = 2_800
