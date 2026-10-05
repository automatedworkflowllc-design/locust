import { LOOK_ABOUT_S, THINKING_CYCLE_S } from './components/Bot.js'
import type { EyeGlyphs } from './components/Bot.js'
import { seeded } from './faceLife.js'
import type { IdleMoment, MomentPick } from './faceLife.js'
import type { GlanceSide } from './glances.js'

/**
 * HIS LIFTS, IN SETS (2026-10-05).
 *
 * Colin, of Codex Buddy: *"maybe has more lifting animations"*, then *"we can
 * figure out a way to cycle in all his lifting animations as well"*. A pet
 * plays one row of its sheet for each thing its teammate does (petMotion.ts):
 * the curls row while it thinks, the press row while it works, round and round.
 * But his maker drew him lifting in five rows -- a shoulder press, curls,
 * hammer curls and squats, a bench press, pull-ups -- and walking a weight in
 * two more. Read drawing by drawing (where the weights sit in each: a press
 * from the chest to the shoulders, overhead, locked out, and back), they are
 * reps. So he lifts in SETS: into the lift, its rep a few times, out of it, a
 * breather between. Working, he goes round all of them; each time he starts
 * work, from the next set on (a short task still shows a new lift); at rest,
 * his own moments now and then are a short set of each in turn (faceLife.ts's
 * moments: `buddyMoment`), so nobody needs a long task to see them.
 *
 * Each beat is one of his drawings, held a while; Locust draws them and melts
 * each into the next (PetSprite). The screen on his face says what he is
 * doing with the bots' own eyes; the body only lifts.
 */

/** One of his drawings, held a while: a beat of a move. */
export interface Beat {
  readonly row: number
  readonly column: number
  readonly ms: number
}

/** A move: its beats in order. */
export interface Move {
  readonly name: string
  readonly beats: readonly Beat[]
  /** Begins again from its first beat (or its next set's, `sets`) when it ends. */
  readonly loops: boolean
  /** Played once, it holds its last beat (stuck under the bar); otherwise it ends at his rest. */
  readonly holds?: boolean
  /** Where each set begins, for a move that goes round several: it starts each time from the next. */
  readonly sets?: readonly number[]
  /** The drawing a still face (reduced motion) shows for it. */
  readonly still: Beat
}

const beat = (row: number, column: number, ms: number): Beat => ({ row, column, ms })

/** A set: into the lift, its rep `reps` times, out of it. */
function set(into: readonly Beat[], rep: readonly Beat[], reps: number, out: readonly Beat[]): readonly Beat[] {
  return [...into, ...Array.from({ length: reps }, () => rep).flat(), ...out]
}

/** His rest: standing, the bar held low in both hands. */
export const REST: Beat = beat(0, 0, 0)

/** A shoulder press (row 7): from his chest to his shoulders, overhead, locked out, back to his shoulders; and down. */
const press = (reps: number): readonly Beat[] =>
  set([beat(7, 0, 300), beat(7, 1, 170)], [beat(7, 2, 150), beat(7, 3, 320), beat(7, 2, 150), beat(7, 1, 220)], reps, [beat(7, 4, 170), beat(7, 5, 300)])

/** Curls (row 8): down, through his waist and chest to his shoulders, and down. */
const curls = (reps: number): readonly Beat[] =>
  set([beat(8, 0, 300)], [beat(8, 1, 140), beat(8, 2, 140), beat(8, 3, 280), beat(8, 4, 160)], reps, [beat(8, 5, 320)])

/** Squats (row 6): standing, and at the bottom -- he has no drawing between, so each is held. */
const squats = (reps: number): readonly Beat[] => set([beat(6, 0, 320)], [beat(6, 2, 520), beat(6, 0, 440)], reps, [])

/**
 * A bench press (row 5). His maker drew the strain in his face, which the
 * screen covers, and the bar's travel small: low (column 1), halfway (3),
 * pressed (4), as the plates sit in each drawing.
 */
const bench = (reps: number): readonly Beat[] =>
  set([beat(5, 0, 420)], [beat(5, 3, 160), beat(5, 4, 320), beat(5, 3, 160), beat(5, 1, 300)], reps, [beat(5, 0, 400)])

/** Pull-ups (row 4): hanging, chin over the bar, hanging. */
const pullUps = (reps: number): readonly Beat[] =>
  set([beat(4, 0, 320)], [beat(4, 1, 160), beat(4, 2, 340), beat(4, 3, 160), beat(4, 4, 280)], reps, [])

/** Hammer curls (row 6): down, up at his shoulders, down; and a flex to finish. */
const hammer = (reps: number): readonly Beat[] =>
  set([beat(6, 0, 300)], [beat(6, 5, 160), beat(6, 3, 300), beat(6, 5, 160), beat(6, 0, 240)], reps, [beat(6, 4, 700), beat(6, 0, 300)])

/** A carry: a weight walked one way and back, in place (rows 1 and 2, his own walks). */
const carry = (): readonly Beat[] => [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((column) => beat(1, column, 120)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((column) => beat(2, column, 120)),
  beat(3, 0, 300)
]

/** A breather between sets: standing, the dumbbells at his sides. */
const BREATHER: readonly Beat[] = [beat(8, 0, 800)]

/** Turned to his left and to his right (rows 2 and 1, standing): where he looks. */
export const LOOKING: Readonly<Record<'left' | 'right', Beat>> = { left: beat(2, 6, 0), right: beat(1, 6, 0) }

/** A workout: each lift, a breather after each, round and round. */
function workout(name: string, lifts: readonly (readonly Beat[])[]): Move {
  const beats: Beat[] = []
  const sets: number[] = []
  for (const lift of lifts) {
    sets.push(beats.length)
    beats.push(...lift, ...BREATHER)
  }
  return { name, beats, loops: true, sets, still: beat(7, 1, 0) }
}

/** Working, delegating, answering, as the face you are talking to: every lift he has. */
export const WORKOUT: Move = workout('workout', [press(3), curls(3), squats(3), bench(3), pullUps(2), hammer(3), carry()])

/**
 * The same, as a face beside a name -- the sidebar, the header -- where a
 * teammate moves less than the one you are talking to (TeammateBot's
 * BotMotionLevel; Colin, 2026-09-23: *"lets tame those two down"*): the lifts
 * he does standing, so he stays where he stands, as a pet's own working row
 * already did. No bench, no bar, no squat, no walk.
 */
export const WORKOUT_STANDING: Move = workout('workout-standing', [press(3), curls(3), hammer(3)])

/** The dots' loop and its look about (Bot's glyphMotion), in ms. */
const DOTS_MS = THINKING_CYCLE_S * 1000
const LOOK_MS = LOOK_ABOUT_S * 1000

/**
 * Thinking: as a bot looks about with its head in thought (Bot's
 * thinkingGlance, the first LOOK_ABOUT_S of each THINKING_CYCLE_S loop of the
 * dots), he looks to his left and then his right; while the dots bounce he
 * scratches his head, or curls a dumbbell slowly. Two of the dots' loops, so
 * he keeps time with them.
 */
export const THINK: Move = {
  name: 'think',
  beats: [
    beat(2, 6, LOOK_MS / 2),
    beat(1, 6, LOOK_MS / 2),
    beat(6, 1, DOTS_MS - LOOK_MS),
    beat(2, 6, LOOK_MS / 2),
    beat(1, 6, LOOK_MS / 2),
    ...[beat(8, 0, 0.24), beat(8, 1, 0.12), beat(8, 2, 0.12), beat(8, 3, 0.24), beat(8, 4, 0.14), beat(8, 5, 0.14)].map((one) => ({ ...one, ms: one.ms * (DOTS_MS - LOOK_MS) }))
  ],
  loops: true,
  still: beat(6, 1, 0)
}

/** Waiting on you: standing by, the dumbbells at his sides; he scratches his head, and looks one way and the other. */
export const WAIT: Move = {
  name: 'wait',
  beats: [beat(6, 0, 1800), beat(6, 1, 1100), beat(6, 0, 1400), beat(2, 6, 900), beat(6, 0, 700), beat(1, 6, 900)],
  loops: true,
  still: beat(6, 0, 0)
}

/** A message just in, or your pointer on him at rest: a wave. */
export const WAVE: Move = {
  name: 'wave',
  beats: [beat(3, 0, 140), beat(3, 1, 170), beat(3, 2, 170), beat(3, 1, 170), beat(3, 2, 170), beat(3, 3, 260)],
  loops: false,
  still: beat(3, 1, 0)
}

/** Just finished: one pull-up, his chin held over the bar, and down to rest. */
export const CHIN_UP: Move = {
  name: 'chin-up',
  beats: [beat(4, 0, 220), beat(4, 1, 150), beat(4, 2, 650), beat(4, 3, 150), beat(4, 4, 240)],
  loops: false,
  still: beat(4, 2, 0)
}

/** Stuck: a bench press that does not go up, the bar sinking back to his chest, held there until someone helps. */
export const STUCK: Move = {
  name: 'stuck',
  beats: [beat(5, 0, 320), beat(5, 3, 200), beat(5, 2, 420), beat(5, 3, 260), beat(5, 7, 320), beat(5, 6, 300)],
  loops: false,
  holds: true,
  still: beat(5, 6, 0)
}

/** At rest, or listening: still, the bar held low. */
export const RESTING: Move = { name: 'rest', beats: [REST], loops: false, still: REST }

const once = (name: string, beats: readonly Beat[]): Move => ({ name, beats, loops: false, still: beats[0] ?? REST })
const held = (name: string, at: Beat, ms: number): Move => ({ name, beats: [beat(at.row, at.column, ms)], loops: false, still: at })

/** A moment's look to one side: turned that way a while. */
const LOOK_LEFT: Move = held('look-left', LOOKING.left, 1800)
const LOOK_RIGHT: Move = held('look-right', LOOKING.right, 1800)

/**
 * HIS MOMENTS AT REST, a short set of each lift and the moments every face
 * has, in turn (`buddyMoment`). Their eyes are the ones a face shows at rest
 * (faceLife.ts): glad `^ ^` or wide `o o`, `c c` dozing -- never the busy
 * eyes, the stuck face, or the green. Each lasts as long as its set, and a
 * moment more at rest.
 */
const MOMENT_MOVES: Readonly<Record<string, Move>> = {
  curls: once('curls', curls(2)),
  press: once('press', press(2)),
  squats: once('squats', squats(2)),
  'pull-up': once('pull-up', pullUps(1)),
  bench: once('bench', bench(2)),
  hammer: once('hammer', hammer(2)),
  carry: once('carry', carry()),
  curious: held('curious', beat(6, 1, 0), 2000),
  doze: held('doze', REST, 2600)
}

/** How long a move takes to play once, in ms. */
export function moveMs(move: Move): number {
  return move.beats.reduce((sum, one) => sum + one.ms, 0)
}

const EYES_GLAD: EyeGlyphs = ['^', '^']
const EYES_WIDE: EyeGlyphs = ['o', 'o']

/** His moments before each is timed to its set. */
const MOMENTS_AT_REST: readonly IdleMoment[] = [
  { name: 'curls', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'press', eyes: EYES_WIDE, seconds: 0 },
  { name: 'look', eyes: EYES_WIDE, glance: { x: 1, y: -0.35 }, seconds: 1.8 },
  { name: 'squats', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'bench', eyes: EYES_WIDE, seconds: 0 },
  { name: 'curious', eyes: EYES_WIDE, mood: 'curious', seconds: 0 },
  { name: 'pull-up', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'carry', eyes: EYES_WIDE, seconds: 0 },
  { name: 'hammer', eyes: EYES_GLAD, mood: 'glad', seconds: 0 },
  { name: 'doze', eyes: ['c', 'c'], state: 'sleeping', seconds: 0 }
]

/** His moments, in the order a face of his goes round them from a seeded start: every lift in a round. */
export const BUDDY_MOMENTS: readonly IdleMoment[] = MOMENTS_AT_REST.map((moment) => {
  const move = MOMENT_MOVES[moment.name]
  // A set's moment lasts the set and a breath at rest after it.
  return move === undefined ? moment : { ...moment, seconds: moveMs(move) / 1000 + 0.4 }
})

/**
 * His `count`th moment at rest (useIdleMoment's `pick`): round all of them in
 * turn, from a start his seed picks, so a few minutes at rest show every lift
 * he has; a look goes to whichever side the seed says.
 */
export function buddyMoment(seed: number, count: number): IdleMoment {
  const start = Math.floor(seeded(seed, 0, 3) * BUDDY_MOMENTS.length)
  const chosen = BUDDY_MOMENTS[(start + count) % BUDDY_MOMENTS.length] ?? BUDDY_MOMENTS[0]
  if (chosen === undefined) return { name: 'doze', eyes: ['c', 'c'], seconds: 2.6 }
  if (chosen.glance === undefined) return chosen
  return { ...chosen, glance: { ...chosen.glance, x: seeded(seed, count, 2) < 0.5 ? -1 : 1 } }
}

/**
 * What he does for what his face is doing (TeammateBot's EverydayFace key):
 * his workout for work -- its standing lifts at the `subtle` level of a face
 * beside a name -- his thinking and his waiting, a wave, a chin-up when he
 * finishes, a bench press that fails when he is stuck, and a moment's set at
 * rest. `look` is where a moment's look goes (its glance's x).
 */
export function buddyMoveFor(key: string, look?: number, level: 'full' | 'subtle' = 'full'): Move {
  switch (key) {
    case 'working':
    case 'delegating':
    case 'responding':
      return level === 'subtle' ? WORKOUT_STANDING : WORKOUT
    case 'thinking':
      return THINK
    case 'waiting':
      return WAIT
    case 'receiving':
    case 'idle:noticed':
      return WAVE
    case 'done':
      return CHIN_UP
    case 'blocked':
      return STUCK
    case 'idle:look':
      return (look ?? 1) < 0 ? LOOK_LEFT : LOOK_RIGHT
    // A beat at work (faceLife.ts's WORKING_BEATS): the thinking beat is his thinking; the rest, his lifts go on.
    case 'working:think':
      return THINK
    default:
      if (key.startsWith('working:')) return level === 'subtle' ? WORKOUT_STANDING : WORKOUT
      return key.startsWith('idle:') ? MOMENT_MOVES[key.slice('idle:'.length)] ?? RESTING : RESTING
  }
}

/** A pet's routine: what it does for what its face is doing, and how it picks its moments at rest. */
export interface PetRoutine {
  readonly moveFor: (key: string, look?: number, level?: 'full' | 'subtle') => Move
  readonly moment: MomentPick
}

const ROUTINES: Readonly<Record<string, PetRoutine>> = {
  'codex-buddy': { moveFor: buddyMoveFor, moment: buddyMoment }
}

/** The routine of a pet whose drawings have been read as moves (his, Codex Buddy's); undefined for any other. */
export function routineFor(id: string): PetRoutine | undefined {
  return ROUTINES[id]
}

/** Where he looks for a glance at a teammate (glances.ts): turned that way, or nowhere for up and down. */
export function glanceBeat(side: GlanceSide): Beat | undefined {
  return side === 'left' ? LOOKING.left : side === 'right' ? LOOKING.right : undefined
}

/** A drawing of a move at a moment: which, and whether the move is done with (nothing more will change). */
export interface MoveCell {
  readonly row: number
  readonly column: number
  readonly settled: boolean
  /** The beat's own length, for how long the drawing before it melts into it. */
  readonly ms: number
}

/**
 * The drawing `elapsed` ms into a move begun at beat `from` (a set's start).
 * A looping move goes round; one played once ends at rest, or on its last
 * beat when it `holds`. Still: the move's still drawing.
 */
export function moveCellAt(move: Move, elapsed: number, from = 0, still = false): MoveCell {
  if (still) return { row: move.still.row, column: move.still.column, settled: true, ms: 0 }
  const beats = move.beats
  const total = moveMs(move)
  if (beats.length === 0 || total <= 0) return { row: REST.row, column: REST.column, settled: true, ms: 0 }
  const start = Math.max(0, Math.min(beats.length - 1, from))
  let time = Math.max(0, elapsed)
  if (!move.loops) {
    let into = 0
    for (let i = start; i < beats.length; i += 1) {
      const one = beats[i] as Beat
      if (time < into + one.ms) return { row: one.row, column: one.column, settled: false, ms: one.ms }
      into += one.ms
    }
    const last = move.holds === true ? (beats[beats.length - 1] as Beat) : REST
    return { row: last.row, column: last.column, settled: true, ms: last.ms }
  }
  time %= total
  for (let k = 0; k < beats.length; k += 1) {
    const one = beats[(start + k) % beats.length] as Beat
    if (time < one.ms) return { row: one.row, column: one.column, settled: false, ms: one.ms }
    time -= one.ms
  }
  const first = beats[start] as Beat
  return { row: first.row, column: first.column, settled: false, ms: first.ms }
}
