import { describe, expect, it } from 'vitest'

import { LOCUST_BOTS } from './locustBots.js'

/**
 * A LOCUST BOT'S EYES STAY ON ITS HEAD.
 *
 * Colin, 2026-09-22, on the first Locust bots: *"maybe check the physics on
 * them, specifically the new ones, locust swarms eyes clip onto his legs when
 * he looks around"*.
 *
 * The library clips the eyes to the body outline and moves them over a
 * sphere as the head turns. Its numbers, from bot-avatars 0.1.1's renderer
 * (dist/index.es.js): the eyes ride a sphere of radius 30 (`Nt = 30`), sit
 * 12.5 either side of the face's centre (`ya = 25`), and an idle glance swings
 * the head up to 36 degrees (`yawW = new Dt(a, 36 * ct, ...)`), scaled by the
 * shape's `turn`. So the leading eye's centre lands at
 *
 *   faceX + faceScale * 30 * sin(asin(12.5 / 30) + 36deg * turn)
 *
 * and that has to be on the part of the outline the face belongs to.
 */

const SPHERE = 30
const HALF_SPACING = 12.5
const IDLE_YAW = (36 * Math.PI) / 180

const leadingEyeX = (shape: (typeof LOCUST_BOTS)[keyof typeof LOCUST_BOTS]): number =>
  shape.faceX + shape.faceScale * SPHERE * Math.sin(Math.asin(HALF_SPACING / SPHERE) + IDLE_YAW * shape.turn)

/** The right edge of an unrotated ellipse `M cx+rx cy A ...` at its own centre line. */
const rightEdge = (path: string): number => Number(/^M([\d.]+) /.exec(path)?.[1] ?? Number.NaN)

const subpaths = (path: string): number => (path.match(/M/g) ?? []).length

describe('the Swarm', () => {
  const swarm = LOCUST_BOTS.swarm

  it('draws its wings behind the body, so an eye can never be drawn on one', () => {
    // Body: the abdomen and the head. Everything else -- four wings and two
    // antennae -- is parts, which the face is not clipped to.
    expect(subpaths(swarm.body)).toBe(2)
    expect(subpaths(swarm.parts)).toBe(6)
  })

  it('keeps the leading eye on its head at the widest idle glance', () => {
    // The head is the body's second ellipse, centred on the face's line.
    const head = swarm.body.slice(swarm.body.indexOf('Z') + 1)
    expect(leadingEyeX(swarm)).toBeLessThan(rightEdge(head))
    // The published first try, for the record: 70.4 against a head edge of 65.
    expect(50 + 0.78 * SPHERE * Math.sin(Math.asin(HALF_SPACING / SPHERE) + IDLE_YAW)).toBeGreaterThan(65)
  })
})

describe('the Critter and the Prompt (0.559)', () => {
  it('draw legs and title-bar dots behind the body, so an eye is never drawn on one', () => {
    // Critter: the block and its two stub arms are body; the four legs are parts.
    expect(subpaths(LOCUST_BOTS.critter.body)).toBe(3)
    expect(subpaths(LOCUST_BOTS.critter.parts)).toBe(4)
    // Prompt (2026-10-05, the Codex mascot): its head (one outline), its body with its legs (one outline) and its two mitts are all body, so the plush furs them all; no parts.
    expect(subpaths(LOCUST_BOTS.prompt.body)).toBe(4)
    expect(LOCUST_BOTS.prompt.parts).toBe('')
  })

  it('keep the leading eye inside the main block at the widest idle glance, clear of its round corner', () => {
    // The critter's block runs x 15..85 with corners of 13; the prompt's cloud of a head to 83.5, its lobes rounding in --
    // drawn 1.26 times larger about x 50 since 0.663 (locustBots' grown), so its edge and its margin with it.
    expect(leadingEyeX(LOCUST_BOTS.critter)).toBeLessThan(85 - 6)
    expect(leadingEyeX(LOCUST_BOTS.prompt)).toBeLessThan(50 + (83.5 - 50) * 1.26 - 9 * 1.26)
  })
})

describe('the Hopper', () => {
  const hopper = LOCUST_BOTS.hopper

  it('draws its legs and antennae behind the body', () => {
    expect(subpaths(hopper.body)).toBe(1)
    expect(subpaths(hopper.parts)).toBe(6)
  })

  it('keeps the leading eye on its body at the widest idle glance', () => {
    expect(leadingEyeX(hopper)).toBeLessThan(rightEdge(hopper.body))
  })
})
