import { afterEach, describe, expect, it, vi } from 'vitest'

import { HEAD_ROWS, buddyHead, cutHead, eyesOn, faceOf } from './buddyBody.js'
import { BUDDY_RIG, BuddyRigSim, REST_TARGET, armJoints, dumbbellReach, headDrop, neckOf } from './buddyRig.js'
import type { RigTarget } from './buddyRig.js'
import { OLD_TWEENS_DATABASE, forgetOldTweens, petWindow } from './components/PetSprite.js'
import { BUDDY_MOMENTS, FLEX, RESTING, STUCK, THINK, WAIT, WAVE, WORKOUT, WORKOUT_STANDING, handoff, handoffMs, momentMove, movePoseAt } from './petRoutines.js'
import type { Move } from './petRoutines.js'
import { CODEX_BUDDY } from './petScreens.js'

/**
 * CODEX BUDDY ON A RIG OF HIS OWN (2026-10-05, buddyRig.ts). Colin: *"youre
 * relying too much on trying to smooth the old animation im saying you should
 * have the tools to make your own"*, then *"make sure its not janky, and
 * production quality"*. His arms and weights are drawn and moved by Locust,
 * on springs, every frame; these hold him to it: his weights stay in the
 * picture however close he is framed, he never jumps, he moves the same at
 * any frame rate, and he comes to rest so his clock can stop.
 */

const MOVES: readonly Move[] = [
  WORKOUT,
  WORKOUT_STANDING,
  THINK,
  WAIT,
  WAVE,
  FLEX,
  STUCK,
  RESTING,
  ...BUDDY_MOMENTS.map((moment) => momentMove(moment.name)).filter((move): move is Move => move !== undefined)
]

/** His framing: the window shown, head and shoulders, at every size. */
const WINDOW = petWindow(CODEX_BUDDY.frameHeight, BUDDY_RIG.middle)

interface Hand {
  readonly x: number
  readonly y: number
  /** How far its weight, where it is in view, is past his window's sides or top, in his drawing's pixels; 0 inside. Below his window it is out of view. */
  readonly out: number
}

const handsOf = (target: RigTarget): readonly Hand[] =>
  ([-1, 1] as const).map((side) => {
    const arm = side < 0 ? target.pose.left : target.pose.right
    const joints = armJoints(arm, side, target.pose.dip)
    const reach = dumbbellReach(arm, joints)
    const inView = joints.hand.y - reach.y < WINDOW.top + WINDOW.side
    const out = inView ? Math.max(0, WINDOW.left - (joints.hand.x - reach.x), joints.hand.x + reach.x - (WINDOW.left + WINDOW.side), WINDOW.top - (joints.hand.y - reach.y)) : 0
    return { x: joints.hand.x, y: joints.hand.y, out }
  })

/**
 * Every move, one after another, cut into at moments a face change would cut
 * it (each played a while, then the next asked for mid-lift), drawn at `fps`
 * as his face draws him (PetSprite's petScreenConductor): each move eased in
 * from where he was (handoff), on his springs. His hands each frame -- or,
 * for a control, `asked`: the moves' own poses, with nothing between.
 */
function run(fps: number, drawn: 'sprung' | 'asked', moves: readonly Move[] = MOVES): readonly (readonly Hand[])[] {
  const sim = new BuddyRigSim()
  const frames: (readonly Hand[])[] = []
  const cuts = [1, 0.37, 0.61, 1, 0.23, 0.5, 0.81]
  moves.forEach((move, i) => {
    const start = move.sets?.[i % move.sets.length] ?? 0
    const span = (move.loops ? move.ms : move.ms + 1500) * (cuts[i % cuts.length] ?? 1)
    const from = i === 0 ? undefined : sim.now()
    const begun = movePoseAt(move, 0, start).target
    const ms = from === undefined ? 0 : handoffMs(from, begun)
    for (let t = 0; t < span + ms; t += 1000 / fps) {
      const own = movePoseAt(move, Math.max(0, t - ms), start).target
      const target = from !== undefined && t < ms ? handoff(from, begun, t / ms) : own
      frames.push(handsOf(drawn === 'sprung' ? sim.step(target, 1 / fps) : own))
    }
  })
  return frames
}

/** Every move cut into by every other, mid-way: the changes a face can make. */
const EVERY_CHANGE: readonly Move[] = MOVES.flatMap((a) => MOVES.flatMap((b) => [a, b]))

/** The most a hand moves in one frame, and the most its movement changes from one frame to the next (a jerk shows as this). */
function motionOf(frames: readonly (readonly Hand[])[]): { readonly step: number; readonly change: number } {
  let step = 0
  let change = 0
  for (let i = 2; i < frames.length; i += 1) {
    for (const h of [0, 1]) {
      const [a, b, c] = [frames[i - 2]?.[h], frames[i - 1]?.[h], frames[i]?.[h]] as [Hand, Hand, Hand]
      step = Math.max(step, Math.hypot(c.x - b.x, c.y - b.y))
      change = Math.max(change, Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y))
    }
  }
  return { step, change }
}

describe('his weights', () => {
  it('stay inside his window, wherever they are in view, through every move and every change between them', () => {
    for (const fps of [30, 60]) {
      const worst = run(fps, 'sprung', EVERY_CHANGE).flat().reduce((most, hand) => Math.max(most, hand.out), 0)
      expect(worst, `${String(fps)} fps`).toBe(0)
    }
  })

  it('would be caught leaving it: a lateral raise, arms straight out, does', () => {
    const raise: RigTarget = { pose: { left: { abduct: 1.45, flex: 0.05, bend: 0.2, bendUp: 0, grip: 0 }, right: REST_TARGET.pose.right, dip: 0 }, look: 0 }
    expect(handsOf(raise)[0]?.out).toBeGreaterThan(10)
  })
})

describe('his face', () => {
  /** How far his screen's corners, tilted and dropped with his head, go past his window; 0 inside. */
  const faceOut = (target: RigTarget): number => {
    const [x, y, w, h] = CODEX_BUDDY.cells[BUDDY_RIG.plate.row]?.[BUDDY_RIG.plate.column] ?? [0, 0, 0, 0]
    const neck = neckOf(target.pose.dip)
    const tilt = target.tilt ?? 0
    const drop = headDrop(target.pose.dip)
    let out = 0
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
      const dx = cx - neck.x
      const dy = cy + drop - neck.y
      const px = neck.x + dx * Math.cos(tilt) - dy * Math.sin(tilt)
      const py = neck.y + dx * Math.sin(tilt) + dy * Math.cos(tilt)
      out = Math.max(out, WINDOW.left - px, px - (WINDOW.left + WINDOW.side), WINDOW.top - py, py - (WINDOW.top + WINDOW.side))
    }
    return out
  }

  it('stays in his window, whole, however his head tilts and his body dips, through every move and every change between them', () => {
    const sim = new BuddyRigSim()
    let worst = 0
    for (const move of EVERY_CHANGE) {
      for (let t = 0; t < move.ms + 500; t += 1000 / 30) worst = Math.max(worst, faceOut(sim.step(movePoseAt(move, t).target, 1 / 30)))
    }
    expect(worst).toBe(0)
  })

  it('would be caught leaving it: his body dropped far down takes it out', () => {
    expect(faceOut({ ...REST_TARGET, pose: { ...REST_TARGET.pose, dip: 60 } })).toBeGreaterThan(5)
  })
})

describe('his motion', () => {
  // A minute: it simulates every change at two frame rates, and under a drive sweep's load it outlasted vitest's
  // default 5 s three times on 2026-10-06 (always on time, never wrong, when retried).
  it('never jumps: a hand moves at most 11 px of his drawing a frame, and its movement changes by at most 5', { timeout: 60_000 }, () => {
    // The most a movement changes is where a change of mind turns back an arm already moving: his spring takes the turn.
    for (const fps of [30, 60]) {
      const { step, change } = motionOf(run(fps, 'sprung', EVERY_CHANGE))
      expect(step, `${String(fps)} fps`).toBeLessThan((11 * 30) / fps)
      expect(change, `${String(fps)} fps`).toBeLessThan((5 * 30 * 30) / (fps * fps))
    }
  })

  it('would be caught jumping: the same moves drawn as asked, with no springs, snap where one cuts into the next', () => {
    const { change } = motionOf(run(30, 'asked'))
    expect(change).toBeGreaterThan(20)
  })

  it('is the same at 30 frames a second as at 60, and as at 144', () => {
    const at = (fps: number): RigTarget => {
      const sim = new BuddyRigSim()
      let now = sim.now()
      for (let t = 0; t <= 2000; t += 1000 / fps) now = sim.step(movePoseAt(WORKOUT, t).target, 1 / fps)
      return now
    }
    const a = handsOf(at(30))
    for (const fps of [60, 144]) {
      const b = handsOf(at(fps))
      for (const h of [0, 1]) expect(Math.hypot((a[h]?.x ?? 0) - (b[h]?.x ?? 0), (a[h]?.y ?? 0) - (b[h]?.y ?? 0)), `${String(fps)} fps`).toBeLessThan(1.5)
    }
  })

  it('picks up after his clock stopped, from where he was, no further than one long frame would take him', () => {
    const sim = new BuddyRigSim()
    const before = handsOf(sim.now())
    const after = handsOf(sim.step(movePoseAt(FLEX, 800).target, 30))
    expect(Math.hypot((after[0]?.x ?? 0) - (before[0]?.x ?? 0), (after[0]?.y ?? 0) - (before[0]?.y ?? 0))).toBeLessThan(25)
  })
})

describe('at rest', () => {
  it('comes to rest within a second and a half of a move ending, so his clock can stop', () => {
    for (const move of [FLEX, WAVE, STUCK, momentMove('press') as Move]) {
      const sim = new BuddyRigSim()
      let t = 0
      for (; t < move.ms; t += 1000 / 30) sim.step(movePoseAt(move, t).target, 1 / 30)
      const end = movePoseAt(move, move.ms + 1).target
      let rested = -1
      for (let s = 0; s < 3; s += 1 / 30) {
        sim.step(end, 1 / 30)
        if (sim.restsAt(end)) {
          rested = s
          break
        }
      }
      expect(rested, move.name).toBeGreaterThanOrEqual(0)
      expect(rested, move.name).toBeLessThan(1.5)
    }
  })

  it('is placed where he is asked at once on a still face, and is at rest there', () => {
    const sim = new BuddyRigSim()
    const placed = sim.place(STUCK.still)
    expect({ pose: placed.pose, look: placed.look }).toEqual(STUCK.still)
    expect(placed.tilt).toBe(0)
    expect(sim.restsAt(STUCK.still)).toBe(true)
    expect(sim.restsAt(REST_TARGET)).toBe(false)
  })
})

describe('his head, cut from his drawing (buddyBody.ts)', () => {
  const W = 192
  const H = 208
  /** A drawing filled with one colour, opaque. */
  const filled = (rgb: readonly [number, number, number]): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(W * H * 4)
    for (let i = 0; i < W * H; i += 1) pixels.set([...rgb, 255], i * 4)
    return pixels
  }
  const alpha = (pixels: Uint8ClampedArray, x: number, y: number): number => pixels[(y * W + x) * 4 + 3] ?? -1

  it('keeps his cap to his chin, and nothing of him below: his body is drawn', () => {
    const head = cutHead(filled([40, 90, 200]))
    for (const [x, y] of [[90, 10], [40, 50], [150, 60], [95, 78]]) expect(alpha(head, x as number, y as number), `${String(x)},${String(y)}`).toBe(255)
    for (const [x, y] of [[90, HEAD_ROWS], [90, 120], [60, 190]]) expect(alpha(head, x as number, y as number), `${String(x)},${String(y)}`).toBe(0)
  })

  it('takes his shirt from under his chin -- its white anywhere, anything beside his chin -- and leaves his chin', () => {
    expect(alpha(cutHead(filled([250, 250, 250])), 95, 76)).toBe(0)
    expect(alpha(cutHead(filled([250, 250, 250])), 95, 60)).toBe(255)
    const skin = cutHead(filled([242, 189, 143]))
    expect(alpha(skin, 95, 78)).toBe(255)
    expect(alpha(skin, 60, 78)).toBe(0)
    expect(alpha(skin, 130, 78)).toBe(0)
  })

  it('finds his face to be his screen: his skin inside his face’s ink, and his eyes and mouth in it; not his ears, his ink or his fringe', () => {
    // A face: a skin disc inside an ink ring, two dark eyes and a mouth in it; an ear of skin outside the ring; a fringe of hair across its top.
    const pixels = filled([30, 30, 34])
    const paint = (x: number, y: number, rgb: readonly [number, number, number]): void => pixels.set([...rgb, 255], (y * W + x) * 4)
    for (let y = 30; y < HEAD_ROWS; y += 1) {
      for (let x = 50; x < 130; x += 1) {
        const d = Math.hypot(x - 88, y - 60)
        if (d < 22) paint(x, y, [242, 189, 143])
        else if (d < 25) paint(x, y, [12, 8, 13])
        if (Math.hypot(x - 58, y - 60) < 4) paint(x, y, [242, 189, 143])
      }
    }
    for (const [x, y] of [[80, 58], [96, 58], [88, 70]]) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) paint(x + dx, y + dy, [20, 18, 22])
    for (let x = 70; x < 106; x += 1) for (let y = 38; y < 44; y += 1) paint(x, y, [25, 22, 24])
    const face = faceOf(pixels) as NonNullable<ReturnType<typeof faceOf>>
    expect(face).toBeDefined()
    const on = (x: number, y: number): number => face.mask[y * W + x] ?? -1
    // His cheeks, and his eyes and mouth, holes in his skin, are his face.
    for (const [x, y] of [[88, 64], [70, 60], [80, 58], [96, 58], [88, 70]]) expect(on(x as number, y as number), `${String(x)},${String(y)}`).toBe(1)
    // His ink round it, his ear outside it, his fringe across its top, and beyond it: not.
    for (const [x, y] of [[88 - 23, 60], [88 + 24, 60], [58, 60], [88, 40], [40, 60]]) expect(on(x as number, y as number), `${String(x)},${String(y)}`).toBe(0)
    // His eyes on it sit inside it.
    const eyes = eyesOn(face.box)
    expect(eyes.x).toBeGreaterThan(face.box.x)
    expect(eyes.x + eyes.w).toBeLessThan(face.box.x + face.box.w)
  })

  it('finds no face where there is no skin: he wears a screen over it instead', () => {
    expect(faceOf(filled([30, 30, 34]))).toBeUndefined()
  })

  describe('as the window reads it', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('is cut once a sheet and kept for every face wearing it; a sheet that cannot be read gives none, and he is drawn as his maker drew him', () => {
      let made = 0
      vi.stubGlobal('document', {
        createElement: () => {
          made += 1
          const pixels = { data: filled([255, 255, 255]) }
          return { width: 0, height: 0, getContext: () => ({ drawImage: () => undefined, getImageData: () => pixels, putImageData: () => undefined }) }
        }
      })
      const sheet = {} as CanvasImageSource
      const head = buddyHead(sheet, W, H)
      expect(head).toBeDefined()
      expect(buddyHead(sheet, W, H)).toBe(head)
      expect(made).toBe(1)
      vi.stubGlobal('document', {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => undefined,
            getImageData: () => {
              throw new Error('tainted')
            }
          })
        })
      })
      expect(buddyHead({} as CanvasImageSource, W, H)).toBeUndefined()
      expect(BUDDY_RIG.plate).toEqual({ row: 8, column: 0 })
    })
  })
})

describe('the in-betweens 0.651 kept', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('are removed from this computer, once a launch, the store they were kept in by name', () => {
    const removed: string[] = []
    vi.stubGlobal('indexedDB', { deleteDatabase: (name: string) => removed.push(name) })
    forgetOldTweens()
    forgetOldTweens()
    expect(removed).toEqual(['locust-pet-tweens'])
    expect(OLD_TWEENS_DATABASE).toBe('locust-pet-tweens')
  })
})
