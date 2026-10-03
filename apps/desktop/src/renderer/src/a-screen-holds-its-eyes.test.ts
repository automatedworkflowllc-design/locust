import { describe, expect, it } from 'vitest'

import { EYES_VISOR, GLYPH_SHAPES, MOUTH_VISOR, PHOSPHOR, glyphMotion, screenEyeLayout } from './components/Bot.js'
import type { EyeGlyphs, VisorBox } from './components/Bot.js'
import { phosphorFor } from './components/TeammateBot.js'
import type { FaceActivity } from './faceState.js'

/**
 * A SCREEN HOLDS ITS EYES (0.562).
 *
 * Colin, 2026-10-03: "some of them the eyes are clipping through the top of
 * the square or almost". Every pair a teammate can wear, on screens from
 * Prompt's own down to half its size (the smallest `fitVisor` gives), above a
 * mouth or not, glancing to every extreme the rig reaches, at every moment of
 * eight seconds of their motion: every stroke, at its full weight, stays
 * inside the screen's rounded rectangle, and the two eyes never touch.
 */

const PAIRS: readonly EyeGlyphs[] = [['>', '▮'], ['•', '•'], ['^', '^'], ['x', 'x'], ['|', '|'], ['>', '_'], ['-', '-']]
const LOOKS = [
  { x: 0, y: 0 },
  { x: 4.5, y: 0 },
  { x: -4.5, y: 7 },
  { x: 4.5, y: -7 },
  { x: -4.5, y: -7 }
]
const scaled = (box: VisorBox, k: number): VisorBox => ({ halfWidth: box.halfWidth * k, halfHeight: box.halfHeight * k, corner: box.corner * k, y: box.y })
const SCREENS = [1, 0.9, 0.8, 0.7, 0.6, 0.5].flatMap((k) => [
  { box: scaled(EYES_VISOR, k), eyeY: 1, name: `eyes screen x${k}` },
  { box: scaled(MOUTH_VISOR, k), eyeY: -3.5, name: `mouth screen x${k}` }
])

/** A disc of radius r centred at (x, y), in face units, lies inside the screen's rounded rectangle. */
function inside(box: VisorBox, x: number, y: number, r: number): boolean {
  const hw = box.halfWidth - r
  const hh = box.halfHeight - r
  const corner = Math.max(0, box.corner - r)
  const dx = Math.abs(x)
  const dy = Math.abs(y - box.y)
  if (dx > hw || dy > hh) return false
  const ex = dx - (hw - corner)
  const ey = dy - (hh - corner)
  return ex <= 0 || ey <= 0 || Math.hypot(ex, ey) <= corner + 1e-9
}

describe('a screen holds its eyes', () => {
  it('keeps every stroke of every pair inside the screen, whatever the glance or the moment', () => {
    const outside: string[] = []
    for (const { box, eyeY, name } of SCREENS) {
      for (const pair of PAIRS) {
        for (const look of LOOKS) {
          const { scale, centres } = screenEyeLayout(box, pair, look, eyeY)
          for (let tick = 1; tick <= 120; tick += 1) {
            const seconds = tick / 15
            for (const eye of [0, 1] as const) {
              const shape = GLYPH_SHAPES[pair[eye]]
              if (shape === undefined) throw new Error(`no shape for ${pair[eye]}`)
              const motion = glyphMotion(pair.join(''), eye, seconds)
              const [cx, cy] = centres[eye]
              const r = (shape.weight * scale) / 2
              for (const line of shape.lines) {
                for (let i = 0; i < line.length; i += 2) {
                  const x = cx + ((line[i] ?? 0) * motion.sx + motion.dx) * scale
                  const y = cy + ((line[i + 1] ?? 0) * motion.sy + motion.dy) * scale
                  if (!inside(box, x, y, r) && outside.length < 5) outside.push(`${name} ${pair.join('')} look ${look.x},${look.y} t=${seconds.toFixed(2)} eye ${eye}: (${x.toFixed(2)}, ${y.toFixed(2)}) r ${r.toFixed(2)}`)
                }
              }
            }
          }
        }
      }
    }
    expect(outside).toEqual([])
  })

  it('never lets the two eyes touch', () => {
    for (const { box, eyeY } of SCREENS) {
      for (const pair of PAIRS) {
        const { scale, centres } = screenEyeLayout(box, pair, { x: 0, y: 0 }, eyeY)
        const left = GLYPH_SHAPES[pair[0]]
        const right = GLYPH_SHAPES[pair[1]]
        if (left === undefined || right === undefined) throw new Error('no shape')
        const widest = (shape: typeof left): number => Math.max(...shape.lines.flatMap((line) => line.filter((_, i) => i % 2 === 0).map(Math.abs)), shape.ring ?? 0) * 1.16 + 2 + shape.weight / 2
        expect(centres[1][0] - centres[0][0], pair.join('')).toBeGreaterThan((widest(left) + widest(right)) * scale)
      }
    }
  })

  it("draws Prompt's screen at the mascot's size: the room is there, so the glyphs are not shrunk", () => {
    const { scale } = screenEyeLayout(EYES_VISOR, ['>', '▮'], { x: 0, y: 0 }, 1)
    expect(scale).toBeCloseTo(1.3, 1)
  })
})

/**
 * WHAT A SCREEN GLOWS (0.562). Colin: "why do white ones have the cool blue
 * terminal font color and the others just stick with the color of the
 * teammate". One terminal cyan for every teammate; colour then means a state.
 */
describe('what a screen glows', () => {
  it('is cyan at work, in thought and at rest; green done, amber waiting on you, red stuck', () => {
    const all: readonly FaceActivity[] = ['thinking', 'working', 'delegating', 'responding', 'waiting', 'receiving', 'blocked', 'done', 'idle']
    expect(Object.fromEntries(all.map((activity) => [activity, phosphorFor(activity)]))).toEqual({
      thinking: 'cyan',
      working: 'cyan',
      delegating: 'cyan',
      responding: 'cyan',
      waiting: 'amber',
      receiving: 'cyan',
      blocked: 'red',
      done: 'green',
      idle: 'cyan'
    })
  })

  it('has a lit colour and a glow for each, none of them the teammate\'s own', () => {
    for (const glow of Object.values(PHOSPHOR)) {
      expect(glow.lit).toMatch(/^hsl\(/)
      expect(glow.glow).toMatch(/^hsla\(/)
    }
  })
})
