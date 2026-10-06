import { describe, expect, it } from 'vitest'

import { BOT_SHAPES, screenSuits } from '../../shared/avatar.js'
import { outlineOf } from './components/Bot.js'
import { LOCUST_BOTS } from './locustBots.js'

/**
 * PROMPT IS THE CODEX MASCOT, IN OUR PLASTIC (2026-10-05). Colin: *"rework
 * our codex teammate to be closer to reality, ours was done a little lazily
 * and in a hurry"*, with the mascot's sheet: a puffy cloud of a head wearing
 * a dark screen for a face, a small body under it with `>_` on its chest,
 * stubby arms and feet. It was a rounded terminal window with three dots.
 */

const prompt = LOCUST_BOTS.prompt
/** Each round of an outline: its centre and radius, from the paths ellipsePath writes (M x0 y0 A r r ...). */
const rounds = (path: string): readonly { readonly x: number; readonly y: number; readonly r: number }[] =>
  [...path.matchAll(/M(-?[\d.]+) (-?[\d.]+)A([\d.]+) ([\d.]+) [-\d.]+ 1 1 (-?[\d.]+) (-?[\d.]+)/g)].map((m) => {
    const [x0, y0, r, , x1, y1] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number]
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r }
  })

/** A height as drawn: the mascot is grown 1.26 times about y 50.5 (0.663). */
const G = (y: number): number => 50.5 + (y - 50.5) * 1.26

describe('Prompt, the Codex mascot', () => {
  /** The head: the body's first subpath, one outline (unionOutline), its points. */
  const head = (): readonly (readonly [number, number])[] => {
    const first = prompt.body.split(/(?=M)/)[0] ?? ''
    return [...first.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
  }

  it('has a cloud for a head, as ONE outline (no seams inside it): wide, its bumps along its top and sides', () => {
    const points = head()
    expect(points.length).toBeGreaterThan(100)
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(width).toBeGreaterThan(height)
    // Bumpy above (the reach from its middle rises and falls along its top), smooth below.
    // Measured as drawn: 1.26 times larger about (50, 50.5) since 0.663 (locustBots' grown).
    const reach = (from: number, to: number): number[] => points.filter(([, y]) => y > from && y < to).map(([x, y]) => Math.hypot(x - 50, y - G(38)))
    const top = reach(0, G(30))
    let turns = 0
    for (let i = 2; i < top.length; i += 1) if (((top[i] ?? 0) - (top[i - 1] ?? 0)) * ((top[i - 1] ?? 0) - (top[i - 2] ?? 0)) < 0) turns += 1
    // Two lumps along its top: a peak, the dip, a peak -- three turns at least (a flat stretch's sampling may add one).
    expect(turns).toBeGreaterThanOrEqual(3)
  })

  it('wears its screen low on its head, most of its face, and its prompt on its chest below', () => {
    expect(prompt.screen).toBe(true)
    expect(prompt.faceY).toBeGreaterThan(38)
    const chest = prompt.chest
    expect(chest?.mark).toBe('prompt')
    // Its body: y 55.5 to 80.5 as designed, grown with it; the chest's prompt inside it.
    expect(chest?.y).toBeGreaterThan(G(55.5) + (chest?.size ?? 0) / 2)
    expect(chest?.y).toBeLessThan(G(80.5) - (chest?.size ?? 0) / 2)
    expect(outlineOf('prompt').chest).toEqual(chest)
  })

  it('has its mitts and legs in its body, so the plush furs them as the rest of it; no parts', () => {
    // Its two mitts, each its own round, a hair clear of its body.
    expect(rounds(prompt.body)).toHaveLength(2)
    expect(prompt.parts).toBe('')
  })

  it('wears the prompt on its chest; only the two mascots wear a mark there, each its own', () => {
    expect(LOCUST_BOTS.spark.chest?.mark).toBe('spark')
    for (const [type, shape] of Object.entries(LOCUST_BOTS)) if (type !== 'prompt' && type !== 'spark') expect(shape.chest, type).toBeUndefined()
  })
})

/**
 * SPARK IS THE CLAUDE MASCOT, IN OUR PLASTIC (2026-10-05). Colin, of
 * github.com/Minecraft-2048/mascotte-claude: *"add this so we can show some
 * love to claude as well ... and obviously swap in our terminal face"*.
 * Measured from that mascot's own board: one starburst of a body, its petals
 * rays fanned over its top and upper sides, its screen in its middle, the
 * asterisk under it, little arms low on its sides, stubby legs.
 */
describe('Spark, the Claude mascot', () => {
  const spark = LOCUST_BOTS.spark
  const outline = (): readonly (readonly [number, number])[] => {
    const first = spark.body.split(/(?=M)/)[0] ?? ''
    return [...first.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
  }

  it('is one outline, its round petals standing out evenly round its top and sides, a notch between each', () => {
    const points = outline()
    expect(points.length).toBeGreaterThan(100)
    const reach = points.filter(([, y]) => y < 46).map(([x, y]) => Math.hypot(x - 50, y - 46))
    // Out to a petal's tip and back into the notch before the next, again and again: a flower, not a ball.
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(5)
    let turns = 0
    for (let i = 2; i < reach.length; i += 1) if (((reach[i] ?? 0) - (reach[i - 1] ?? 0)) * ((reach[i - 1] ?? 0) - (reach[i - 2] ?? 0)) < 0) turns += 1
    expect(turns).toBeGreaterThanOrEqual(8)
  })

  it('wears its screen in its middle, always, and its asterisk under it', () => {
    expect(spark.screen).toBe(true)
    expect(spark.chest?.y).toBeGreaterThan(spark.faceY + 17.5 * spark.faceScale + (spark.chest?.size ?? 0) / 2)
    expect(outlineOf('spark').chest).toEqual(spark.chest)
  })

  it('has its legs in its body, so the plush furs them; no parts', () => {
    expect(rounds(spark.body)).toHaveLength(2)
    expect(spark.parts).toBe('')
  })

  it('is picked only: no teammate’s derived face becomes it', () => {
    expect(BOT_SHAPES.indexOf('spark')).toBeGreaterThanOrEqual(20)
    expect(screenSuits('spark')).toBe(true)
  })
})
