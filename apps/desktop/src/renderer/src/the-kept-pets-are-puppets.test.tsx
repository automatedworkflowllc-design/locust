import { renderToStaticMarkup } from 'react-dom/server'
import { BOT_AVATAR_OVERSCAN, BOT_AVATAR_RISE } from 'bot-avatars'
import type { BotAvatarPose } from 'bot-avatars'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { seedAvatar } from '../../shared/avatar.js'
import type { AvatarSpec, PetRef } from '../../shared/avatar.js'
import { PET_COLUMNS } from '../../shared/pets.js'
import { setTerminalFaces } from './botLook.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { PUPPET_SQUASH, puppetBody, puppetDrawing, puppetRect, puppetTransform } from './components/PetPuppet.js'
import { TeammateBot } from './components/TeammateBot.js'
import { PET_PUPPETS, puppetFor } from './petPuppets.js'
import type { PetPuppet } from './petPuppets.js'
import { CODEX_BUDDY, EDGE_SLACK, screenFits } from './petScreens.js'
import type { PetScreenFace } from './petScreens.js'
import { ensurePet, petLook, setPetLook } from './pets.js'
import type { PetAtlas } from './pets.js'

/**
 * THE PETS COLIN KEPT ARE PUPPETS WITH OUR EYES (2026-10-05, petPuppets.ts).
 *
 * Colin: *"i want you to stylize and redesign these in our teammate style with
 * the terminal face ... either way i want our terminal eyes"*, and, shown the
 * first try: *"you just drew a circle around some of them and chopped off
 * their ears lol"*. Each is one drawing on a bot's rig (PetPuppet.tsx) with a
 * screen on its face; a head on a body that walks, or on a stand, is cut from
 * it at its neck, and nothing of the head is cut.
 */

const KEPT = ['cabin-face', 'astro-bot', 'meowbot', 'macintosh', 'bitty', 'tmuxai', 'rainbow-terminal-cat', 'nori']
const CUT = ['astro-bot', 'meowbot', 'tmuxai']
const BITTY: PetRef = { source: 'gallery', id: 'bitty' }
const CAT: PetRef = { source: 'bundled', id: 'hoodie-cat' }
const BUDDY: PetRef = { source: 'gallery', id: 'codex-buddy' }
const wearing = (pet: PetRef): AvatarSpec => ({ ...seedAvatar('tm_bitty'), bot: { shape: 'droid', face: 'eyes' }, pet })
const atlas = (puppet?: PetPuppet): PetAtlas => ({
  image: {} as CanvasImageSource,
  rows: 9,
  frameWidth: 192,
  frameHeight: 208,
  body: { left: 0.03, top: 0.04, right: 0.97, bottom: 0.96 },
  dark: false,
  ...(puppet === undefined ? {} : { puppet })
})
const puppet = (id: string): PetPuppet => {
  const found = puppetFor(id)
  if (found === undefined) throw new Error(`no puppet ${id}`)
  return found
}
/** The resting drawing's painted left, top, right and bottom, as measured. */
const restEdges = (p: PetPuppet): readonly number[] => p.edges[p.rest[0]]?.[p.rest[1]] ?? []
const puppeted = (html: string): boolean => html.includes('data-puppet="on"')

afterEach(() => {
  setPetLook(BITTY, undefined)
  setPetLook(CAT, undefined)
  setPetLook(BUDDY, undefined)
  setTerminalFaces(true)
})

/** A sheet painted where the measured one is, drawing by drawing: each cell's four edges. */
function sheetLike(
  p: PetPuppet,
  move?: { readonly row: number; readonly column: number; readonly edge: 0 | 1 | 2 | 3; readonly by: number }
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = p.frameWidth * PET_COLUMNS
  const height = p.frameHeight * 9
  const data = new Uint8ClampedArray(width * height * 4)
  p.edges.forEach((row, r) => {
    row.forEach((edges, c) => {
      const box = [...edges]
      if (move !== undefined && move.row === r && move.column === c) box[move.edge] = (box[move.edge] ?? 0) + move.by
      const [left = 0, top = 0, right = 0, bottom = 0] = box
      for (let y = r * p.frameHeight + top; y < r * p.frameHeight + bottom; y += 1) {
        for (let x = c * p.frameWidth + left; x < c * p.frameWidth + right; x += 1) data[(y * width + x) * 4 + 3] = 255
      }
    })
  })
  return { data, width, height }
}

describe('the pets Colin kept', () => {
  it('are the eight he named, each once; Codex Buddy keeps his own drawings', () => {
    expect([...PET_PUPPETS.map((p) => p.id)].sort()).toEqual([...KEPT].sort())
    expect(puppetFor('codex-buddy')).toBeUndefined()
    expect(puppetFor('hoodie-cat')).toBeUndefined()
  })
})

describe('nothing of a head is cut', () => {
  it('keeps all of each drawing above its neck, from its very top: no ear, antenna or headphone is lost', () => {
    for (const p of PET_PUPPETS) {
      const [left = 0, top = 0, right = 0, bottom = 0] = restEdges(p)
      expect(p.paint[1], p.id).toBe(top)
      expect(p.paint[0], p.id).toBeGreaterThanOrEqual(left)
      expect(p.paint[2], p.id).toBeLessThanOrEqual(right)
      // Kept whole, all of it.
      if (p.neck === undefined) expect([...p.paint], p.id).toEqual([left, top, right, bottom])
    }
  })

  it('cuts only a body that walks and a stand, straight across its neck, well below its screen', () => {
    expect(PET_PUPPETS.filter((p) => p.neck !== undefined).map((p) => p.id)).toEqual(CUT)
    for (const id of CUT) {
      const p = puppet(id)
      const neck = p.neck ?? 0
      const [, , , bottom = 0] = restEdges(p)
      // Something is cut: its body is below its neck.
      expect(neck, id).toBeLessThan(bottom - 30)
      expect(p.paint[3], id).toBeLessThanOrEqual(neck)
      const [, glassY, , glassH] = p.glass
      expect(neck - (glassY + glassH), id).toBeGreaterThan(10)
    }
  })

  it('shows in its box all of what is kept, with a little air, centred on it', () => {
    for (const p of PET_PUPPETS) {
      const [left, top, side] = p.window
      const [paintLeft, paintTop, paintRight, paintBottom] = p.paint
      expect(left, p.id).toBeLessThanOrEqual(paintLeft)
      expect(top, p.id).toBeLessThanOrEqual(paintTop)
      expect(left + side, p.id).toBeGreaterThanOrEqual(paintRight)
      expect(top + side, p.id).toBeGreaterThanOrEqual(paintBottom)
      expect(Math.abs(left + side / 2 - (paintLeft + paintRight) / 2), p.id).toBeLessThan(2)
      expect(Math.abs(top + side / 2 - (paintTop + paintBottom) / 2), p.id).toBeLessThan(2)
      expect(side / Math.max(paintRight - paintLeft, paintBottom - paintTop), p.id).toBeLessThan(1.1)
    }
  })
})

describe('their screens', () => {
  it('each sits on its face: inside what is drawn of it, above its neck', () => {
    for (const p of PET_PUPPETS) {
      const [x, y, w, h] = p.glass
      expect(x, p.id).toBeGreaterThanOrEqual(p.paint[0])
      expect(x + w, p.id).toBeLessThanOrEqual(p.paint[2])
      expect(y, p.id).toBeGreaterThanOrEqual(p.paint[1])
      expect(y + h, p.id).toBeLessThanOrEqual(p.paint[3])
    }
  })

  it('each has room for a bot’s two eyes in its box', () => {
    for (const p of PET_PUPPETS) {
      const glass = puppetRect(p, ...p.glass)
      expect(glass.w, p.id).toBeGreaterThanOrEqual(28)
      expect(glass.h, p.id).toBeGreaterThanOrEqual(14)
    }
  })

  it('cut from its body, a head’s screen is a quarter as big again as its pet’s fitted whole', () => {
    for (const id of CUT) {
      const p = puppet(id)
      const [, , w] = p.glass
      expect(puppetRect(p, ...p.glass).w / ((w * 100) / p.frameHeight), id).toBeGreaterThan(1.2)
    }
  })
})

describe('drawn on a bot’s rig', () => {
  const pose = (changes: Partial<BotAvatarPose> = {}): BotAvatarPose => ({
    yaw: 0,
    pitch: 0,
    roll: 0,
    x: 0,
    y: 0,
    sx: 1,
    sy: 1,
    eyeOpen: 1,
    blinkL: 0,
    blinkR: 0,
    lookX: 0,
    lookY: 0,
    breath: 0,
    laugh: 0,
    whirl: 0,
    whirlAngle: 0,
    w: [1, 0, 0],
    ...changes
  })
  /** Where a point of the box (its units) lands on the canvas, in device pixels. */
  const place = (matrix: readonly number[], x: number, y: number): readonly [number, number] => {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = matrix
    return [a * x + c * y + e, b * x + d * y + f]
  }

  it('draws its resting drawing, as much as its window shows, and nothing below its neck', () => {
    for (const p of PET_PUPPETS) {
      const { from } = puppetDrawing(p, p.frameWidth, p.frameHeight)
      const [row, column] = p.rest
      const cellX = column * p.frameWidth
      const cellY = row * p.frameHeight
      expect(from.x, p.id).toBeGreaterThanOrEqual(cellX)
      expect(from.x + from.w, p.id).toBeLessThanOrEqual(cellX + p.frameWidth)
      expect(from.y, p.id).toBeGreaterThanOrEqual(cellY)
      expect(from.y + from.h, p.id).toBeLessThanOrEqual(cellY + (p.neck ?? p.frameHeight))
      // All of what is kept.
      expect(from.x, p.id).toBeLessThanOrEqual(cellX + p.paint[0])
      expect(from.x + from.w, p.id).toBeGreaterThanOrEqual(cellX + p.paint[2])
      expect(from.y, p.id).toBeLessThanOrEqual(cellY + p.paint[1])
      expect(from.y + from.h, p.id).toBeGreaterThanOrEqual(cellY + p.paint[3])
    }
  })

  it('lays its window on the bot’s body box, a hundred units across', () => {
    for (const p of PET_PUPPETS) {
      const [left, top, side] = p.window
      const box = puppetRect(p, left, top, side, side)
      expect(box.x, p.id).toBeCloseTo(-50)
      expect(box.y, p.id).toBeCloseTo(-50)
      expect(box.w, p.id).toBeCloseTo(100)
      expect(box.h, p.id).toBeCloseTo(100)
    }
  })

  it('stands where a bot does: its box centred on the canvas and raised as a bot’s', () => {
    const size = 44
    const dpr = 2
    const side = size * BOT_AVATAR_OVERSCAN * dpr
    const rest = puppetTransform(pose(), size, dpr)
    expect(place(rest, 0, 0)).toEqual([side / 2, side / 2 + BOT_AVATAR_RISE * size * dpr])
    const [left, top] = place(rest, -50, -50)
    const [right, bottom] = place(rest, 50, 50)
    expect(right - left).toBeCloseTo(size * dpr)
    expect(bottom - top).toBeCloseTo(size * dpr)
  })

  it('lands on its foot, squashed half as far as a screen-faced bot', () => {
    const size = 44
    const rest = puppetTransform(pose(), size, 1)
    const squashed = puppetTransform(pose({ sx: 1.2, sy: 0.8 }), size, 1)
    // Its foot stays where it was; the height it loses comes off its top.
    expect(place(squashed, 0, 50)[1]).toBeCloseTo(place(rest, 0, 50)[1])
    const height = place(squashed, 0, 50)[1] - place(squashed, 0, -50)[1]
    const width = place(squashed, 50, 0)[0] - place(squashed, -50, 0)[0]
    expect(height / size).toBeCloseTo(1 - 0.2 * PUPPET_SQUASH)
    expect(width / size).toBeCloseTo(1 + 0.2 * PUPPET_SQUASH)
    expect(PUPPET_SQUASH).toBeLessThanOrEqual(0.5)
  })

  it('leans with the rig, and moves a little the way it turns and nods', () => {
    const size = 44
    const rest = puppetTransform(pose(), size, 1)
    const leaning = puppetTransform(pose({ roll: 0.2 }), size, 1)
    expect(leaning[1]).toBeCloseTo(Math.sin(0.2) * (size / 100))
    const turned = place(puppetTransform(pose({ yaw: 0.5 }), size, 1), 0, 0)[0] - place(rest, 0, 0)[0]
    expect(turned).toBeGreaterThan(0)
    expect(turned).toBeLessThan(0.05 * size)
    const lifted = place(puppetTransform(pose({ pitch: 0.12 }), size, 1), 0, 0)[1] - place(rest, 0, 0)[1]
    expect(lifted).toBeLessThan(0)
  })

  it('puts its ring and dot on what is drawn of it, not on a body it no longer has', () => {
    for (const p of PET_PUPPETS) {
      const body = puppetBody(p)
      expect(body.left, p.id).toBeLessThan(body.right)
      expect(body.top, p.id).toBeLessThan(body.bottom)
      for (const edge of [body.left, body.top, body.right, body.bottom]) {
        expect(edge, p.id).toBeGreaterThanOrEqual(0)
        expect(edge, p.id).toBeLessThanOrEqual(1)
      }
    }
    // Astro Bot's ends at its helmet's rim; its feet were below the bottom of its box.
    const astro = puppet('astro-bot')
    const [, top, side] = astro.window
    expect(puppetBody(astro).bottom).toBeCloseTo((136 - top) / side)
    expect(puppetBody(astro).bottom).toBeLessThan(0.92)
  })
})

describe('its sheet is checked before it becomes a puppet', () => {
  it('takes the sheet measured, by each drawing’s four edges', () => {
    for (const p of PET_PUPPETS) {
      const sheet = sheetLike(p)
      expect(screenFits(p, sheet.data, sheet.width, sheet.height), p.id).toBe(true)
    }
  })

  it('takes it re-compressed, an edge a pixel or two off', () => {
    const p = puppet('bitty')
    const sheet = sheetLike(p, { row: 4, column: 1, edge: 1, by: EDGE_SLACK })
    expect(screenFits(p, sheet.data, sheet.width, sheet.height)).toBe(true)
  })

  it('refuses one redrawn taller or shorter, though its sides are where they were', () => {
    // Some makers fill every drawing edge to edge: a drawing's sides alone do not tell one sheet from another.
    const p = puppet('nori')
    for (const edge of [1, 3] as const) {
      const sheet = sheetLike(p, { row: 6, column: 2, edge, by: EDGE_SLACK + 2 })
      expect(screenFits(p, sheet.data, sheet.width, sheet.height), String(edge)).toBe(false)
    }
  })
})

describe('its sheet, as the window reads it', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A canvas that hands back the given sheet's pixels, for the window's own read of a sheet (pets.ts). */
  const document = (sheet: { data: Uint8ClampedArray; width: number }): unknown => ({
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (x: number, y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4)
          for (let row = 0; row < h; row += 1) {
            const from = ((y + row) * sheet.width + x) * 4
            data.set(sheet.data.subarray(from, from + w * 4), row * w * 4)
          }
          return { data }
        }
      })
    })
  })
  const read = async (ref: PetRef, sheet: { data: Uint8ClampedArray; width: number; height: number }): Promise<PetAtlas | undefined> => {
    vi.stubGlobal('window', { desktop: { readPetSheet: async () => ({ ok: true, data: { bytes: new Uint8Array(4), rows: 9 } }) } })
    vi.stubGlobal('document', document(sheet))
    vi.stubGlobal('createImageBitmap', async () => ({ width: sheet.width, height: sheet.height }))
    setPetLook(ref, undefined)
    await ensurePet(ref)
    const look = petLook(ref)
    return look.status === 'ready' ? look.atlas : undefined
  }
  /** Codex Buddy's sheet as his table has it: his two edges, his maker's rows 5 to 203. */
  const buddySheet = (face: PetScreenFace): { data: Uint8ClampedArray; width: number; height: number } =>
    sheetLike({
      ...puppet('bitty'),
      counts: face.counts,
      edges: face.edges.map((row) => row.map(([left, right]) => [left, 5, right, 203]))
    })

  it('makes it a puppet when it is the sheet measured, and not when it is another', async () => {
    const bitty = puppet('bitty')
    expect((await read(BITTY, sheetLike(bitty)))?.puppet).toBe(bitty)
    expect((await read(BITTY, sheetLike(bitty, { row: 2, column: 3, edge: 0, by: EDGE_SLACK + 3 })))?.puppet).toBeUndefined()
    // Another pet drawn the same is still not Bitty.
    expect((await read(CAT, sheetLike(bitty)))?.puppet).toBeUndefined()
  })

  it('leaves Codex Buddy his screen, and makes no puppet of him', async () => {
    const buddy = await read(BUDDY, buddySheet(CODEX_BUDDY))
    expect(buddy?.screen).toBe(CODEX_BUDDY)
    expect(buddy?.puppet).toBeUndefined()
  })
})

describe('a teammate wearing one', () => {
  it('lives on a bot’s rig, a screen on its face, while Terminal faces is on', () => {
    setPetLook(BITTY, { status: 'ready', atlas: atlas(puppet('bitty')) })
    const html = renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(BITTY)} size={44} activity="working" teammateId="tm_bitty" name="Bitty" />)
    expect(puppeted(html)).toBe(true)
    expect(html).toContain('data-screen="on"')
    // Still a pet's face, with a teammate's hooks.
    expect(html).toContain('data-face="pet"')
    expect(html).toContain('data-pet="bitty"')
    expect(html).toContain('data-pet-state="running"')
    expect(html).toContain('aria-label="Bitty"')
  })

  it('is drawn as its maker drew it with Terminal faces off, when its teammate asks, or on a sheet not measured', () => {
    setPetLook(BITTY, { status: 'ready', atlas: atlas(puppet('bitty')) })
    setTerminalFaces(false)
    expect(puppeted(renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(BITTY)} size={44} activity="working" />))).toBe(false)
    setTerminalFaces(true)
    expect(puppeted(renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing({ ...BITTY, screen: false })} size={44} activity="working" />))).toBe(false)
    expect(puppeted(renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing({ ...BITTY, screen: true })} size={44} activity="working" />))).toBe(true)
    setPetLook(BITTY, { status: 'ready', atlas: atlas() })
    const drawn = renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(BITTY)} size={44} activity="working" />)
    expect(drawn).toContain('data-pet="bitty"')
    expect(puppeted(drawn)).toBe(false)
  })

  it('bounces as it works, as a bot does, where a pet as drawn moves in its own drawings', () => {
    setPetLook(BITTY, { status: 'ready', atlas: atlas(puppet('bitty')) })
    const bounces = (avatar: AvatarSpec): boolean => / class="lc-face lc-bot is-bouncing"/.test(renderToStaticMarkup(<TeammateBot hue="lime" avatar={avatar} size={34} activity="working" />))
    expect(bounces(wearing(BITTY))).toBe(true)
    expect(bounces(wearing({ ...BITTY, screen: false }))).toBe(false)
  })
})

describe('its teammate’s look', () => {
  const open = (avatar: AvatarSpec): string =>
    renderToStaticMarkup(
      <NewTeammateDialog
        onCancel={() => undefined}
        onCreate={() => undefined}
        error={undefined}
        mode="accept-edits"
        initial={{ teammateId: 'tm_bitty', name: 'Bitty', hue: 'lime', role: 'Docs & QA', avatar, createdAt: '2026-10-05T00:00:00.000Z' }}
      />
    )
  const chosen = (html: string): string | undefined => /aria-checked="true" class="is-selected"[^>]*>(As drawn|Screen)</.exec(html)?.[1]

  it('offers it as drawn or the screen, the screen until asked otherwise', () => {
    setPetLook(BITTY, { status: 'ready', atlas: atlas(puppet('bitty')) })
    const html = open(wearing(BITTY))
    expect(html).toContain('aria-label="Face"')
    expect(html).toContain('title="As its maker drew it."')
    expect(chosen(html)).toBe('Screen')
    expect(chosen(open(wearing({ ...BITTY, screen: false })))).toBe('As drawn')
  })

  it('offers nothing for a pet whose sheet was not measured', () => {
    setPetLook(BITTY, { status: 'ready', atlas: atlas() })
    expect(open(wearing(BITTY))).not.toContain('aria-label="Face"')
  })
})
