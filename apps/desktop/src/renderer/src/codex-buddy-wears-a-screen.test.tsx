import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanAvatar, isAvatarSpec, isPetRef, seedAvatar } from '../../shared/avatar.js'
import type { AvatarSpec, PetRef } from '../../shared/avatar.js'
import { PET_COLUMNS } from '../../shared/pets.js'
import { BOT_SIZE } from './botSizes.js'
import { setTerminalFaces } from './botLook.js'
import { NewTeammateDialog } from './components/NewTeammateDialog.js'
import { CLOSE_UNTIL_PX, WHOLE_FROM_PX, petWindow } from './components/PetSprite.js'
import { TeammateBot } from './components/TeammateBot.js'
import { routineFor } from './petRoutines.js'
import { CODEX_BUDDY, EDGE_SLACK, paintedEdges, screenAt, screenFaceFor, screenFits } from './petScreens.js'
import type { PetScreenFace } from './petScreens.js'
import { ensurePet, petLook, setPetLook } from './pets.js'
import type { PetAtlas } from './pets.js'

/**
 * CODEX BUDDY WEARS A SCREEN (2026-10-05).
 *
 * Colin, of Codex Buddy: *"do you think you could make a new animation for
 * him where he has the terminal face"* -- then, shown him so: *"yeah i love
 * your idea build it"*. His drawings stay his maker's, downloaded when he is
 * picked; Locust draws a screen over his face from where his face is in each
 * of them (petScreens.ts), only on the sheet that was measured, and only while
 * Terminal faces is on and his teammate has not asked for him as drawn.
 */

const BUDDY: PetRef = { source: 'gallery', id: 'codex-buddy' }
const CAT: PetRef = { source: 'bundled', id: 'hoodie-cat' }
const wearing = (pet: PetRef): AvatarSpec => ({ ...seedAvatar('tm_buddy'), bot: { shape: 'droid', face: 'eyes' }, pet })
const atlas = (screen?: PetScreenFace): PetAtlas => ({
  image: {} as CanvasImageSource,
  rows: 9,
  frameWidth: 192,
  frameHeight: 208,
  body: { left: 0.2, top: 0.02, right: 0.8, bottom: 0.98 },
  dark: false,
  ...(screen === undefined ? {} : { screen })
})
const screened = (html: string): boolean => html.includes('data-screen="on"')

afterEach(() => {
  setPetLook(BUDDY, undefined)
  setPetLook(CAT, undefined)
  setTerminalFaces(true)
})

/** A sheet painted where his is, drawing by drawing: each cell's measured edges, top to bottom as his maker fills them. */
function sheetLike(face: PetScreenFace, move?: { readonly row: number; readonly column: number; readonly by: number }): { data: Uint8ClampedArray; width: number; height: number } {
  const width = face.frameWidth * PET_COLUMNS
  const height = face.frameHeight * 9
  const data = new Uint8ClampedArray(width * height * 4)
  face.edges.forEach((row, r) => {
    row.forEach(([left, right], c) => {
      const shift = move !== undefined && move.row === r && move.column === c ? move.by : 0
      for (let y = r * face.frameHeight + 5; y < r * face.frameHeight + 203; y += 1) {
        for (let x = c * face.frameWidth + left + shift; x < c * face.frameWidth + right + shift; x += 1) data[(y * width + x) * 4 + 3] = 255
      }
    })
  })
  return { data, width, height }
}

describe('his table', () => {
  it('is his alone: no other pet has a screen measured for it, or moves of its own', () => {
    expect(screenFaceFor('codex-buddy')).toBe(CODEX_BUDDY)
    expect(screenFaceFor('hoodie-cat')).toBeUndefined()
    expect(screenFaceFor('astro-bot')).toBeUndefined()
    expect(routineFor('codex-buddy')).toBeDefined()
    expect(routineFor('hoodie-cat')).toBeUndefined()
  })

  it('has a screen on every one of his drawings, inside the drawing he is painted in', () => {
    CODEX_BUDDY.counts.forEach((count, row) => {
      expect(CODEX_BUDDY.cells[row]).toHaveLength(count)
      expect(CODEX_BUDDY.edges[row]).toHaveLength(count)
      for (let column = 0; column < count; column += 1) {
        const rect = screenAt(CODEX_BUDDY, row, column)
        const [left, right] = CODEX_BUDDY.edges[row]?.[column] ?? [0, 0]
        expect(rect, `${String(row)},${String(column)}`).toBeDefined()
        if (rect === undefined) continue
        expect(rect.x).toBeGreaterThanOrEqual(left)
        expect(rect.x + rect.w).toBeLessThanOrEqual(right)
        expect(rect.y).toBeGreaterThanOrEqual(5)
        expect(rect.y + rect.h).toBeLessThanOrEqual(203)
        // A face's screen, not a speck: big enough for a bot's two eyes.
        expect(rect.w).toBeGreaterThanOrEqual(30)
        expect(rect.h).toBeGreaterThanOrEqual(22)
      }
      expect(screenAt(CODEX_BUDDY, row, count)).toBeUndefined()
    })
  })

  it('holds its size as he moves: one size for each way he faces', () => {
    const size = (row: number, column: number): string => {
      const [, , w, h] = CODEX_BUDDY.cells[row]?.[column] ?? [0, 0, 0, 0]
      return `${String(w)}x${String(h)}`
    }
    const sizes = (cells: readonly (readonly [number, number])[]): ReadonlySet<string> => new Set(cells.map(([row, column]) => size(row, column)))
    const row = (r: number, columns: readonly number[]): (readonly [number, number])[] => columns.map((c) => [r, c] as const)
    // Facing you: standing, waving, at the bar, curling, pressing.
    const facing = [...row(0, [0, 1, 2, 3, 4, 5]), ...row(3, [0, 1, 2, 3]), ...row(4, [1, 2, 3]), ...row(6, [0, 1, 3, 4, 5]), ...row(7, [0, 1, 2, 4, 5]), ...row(8, [0, 1, 2, 3, 4, 5])]
    expect(sizes(facing)).toEqual(new Set(['37x27']))
    // Turned, walking right or left: one size for both.
    expect(sizes([...row(1, [0, 1, 2, 3, 4, 5, 6, 7]), ...row(2, [0, 1, 2, 3, 4, 5, 6, 7])])).toEqual(new Set(['37x30']))
    // On the bench, his head nearer and over his brows.
    expect(sizes(row(5, [0, 1, 2, 3, 4, 5, 6, 7]))).toEqual(new Set(['39x31']))
    // Squatting, drawn larger, and his head tucked between his arms, hanging and locked out: smaller, as measured.
    expect(size(6, 2)).toBe('44x32')
    for (const [r, c] of [[4, 0], [4, 4], [7, 3]] as const) expect(Number(size(r, c).split('x')[0])).toBeLessThan(37)
  })
})

describe('framed by how big he is drawn', () => {
  /** His screen's width in a box `size` across, as the box frames him. */
  const screenWidth = (size: number): number => (37 * size) / petWindow(size, 192, 208).side

  it('closest where he is usually seen, so his face is half as big again as fitted whole', () => {
    for (const size of [BOT_SIZE.threadLive, BOT_SIZE.sidebarFaces, BOT_SIZE.workroomHeader, BOT_SIZE.rosterCard]) {
      expect(screenWidth(size) / ((37 * size) / 208), String(size)).toBeGreaterThan(1.4)
    }
    expect(screenWidth(BOT_SIZE.sidebarFaces)).toBeGreaterThan(8)
  })

  it('easing out as he is drawn larger, and whole from 96 px', () => {
    const sides = [CLOSE_UNTIL_PX, 56, 64, 80, WHOLE_FROM_PX].map((size) => petWindow(size, 192, 208).side)
    for (let i = 1; i < sides.length; i += 1) expect(sides[i]).toBeGreaterThan(sides[i - 1] ?? 0)
    expect(petWindow(WHOLE_FROM_PX, 192, 208)).toEqual({ left: -8, top: 0, side: 208 })
    expect(petWindow(200, 192, 208).side).toBe(208)
    expect(petWindow(20, 192, 208)).toEqual(petWindow(CLOSE_UNTIL_PX, 192, 208))
  })

  it('never cuts his face: on every drawing, his screen is inside the closest window', () => {
    const shown = petWindow(CLOSE_UNTIL_PX, 192, 208)
    CODEX_BUDDY.cells.forEach((row, r) =>
      row.forEach(([x, y, w, h], c) => {
        const where = `${String(r)},${String(c)}`
        expect(x - 2, where).toBeGreaterThanOrEqual(shown.left)
        expect(x + w + 2, where).toBeLessThanOrEqual(shown.left + shown.side)
        expect(y - 2, where).toBeGreaterThanOrEqual(shown.top)
        expect(y + h + 2, where).toBeLessThanOrEqual(shown.top + shown.side)
      })
    )
  })
})

describe('his sheet is checked before he wears a screen', () => {
  it('takes the sheet that was measured', () => {
    const sheet = sheetLike(CODEX_BUDDY)
    expect(screenFits(CODEX_BUDDY, sheet.data, sheet.width, sheet.height)).toBe(true)
  })

  it('takes it re-compressed: an edge a pixel or two off is the same drawing', () => {
    // Re-compressed at WebP quality 75 his edges did not move at all; another encoder's may, by a pixel or two.
    const sheet = sheetLike(CODEX_BUDDY, { row: 5, column: 2, by: 2 })
    expect(screenFits(CODEX_BUDDY, sheet.data, sheet.width, sheet.height)).toBe(true)
  })

  it('refuses one redrawn, resized, or with a drawing where his has none', () => {
    const moved = sheetLike(CODEX_BUDDY, { row: 7, column: 3, by: EDGE_SLACK + 2 })
    expect(screenFits(CODEX_BUDDY, moved.data, moved.width, moved.height)).toBe(false)
    const sheet = sheetLike(CODEX_BUDDY)
    expect(screenFits(CODEX_BUDDY, sheet.data, sheet.width, sheet.height - 208)).toBe(false)
    // A drawing in row 0's empty seventh cell.
    for (let y = 5; y < 203; y += 1) sheet.data[(y * sheet.width + 6 * 192 + 90) * 4 + 3] = 255
    expect(screenFits(CODEX_BUDDY, sheet.data, sheet.width, sheet.height)).toBe(false)
  })

  it('reads a drawing’s painted sides', () => {
    const sheet = sheetLike(CODEX_BUDDY)
    expect(paintedEdges(sheet.data, sheet.width, 0, 0, 192, 208)).toEqual([33, 158])
    expect(paintedEdges(sheet.data, sheet.width, 7 * 192, 0, 192, 208)).toBeUndefined()
  })
})

describe('his sheet, as the window reads it', () => {
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
  const read = async (ref: PetRef, sheet: { data: Uint8ClampedArray; width: number; height: number }): Promise<PetScreenFace | undefined | 'not ready'> => {
    vi.stubGlobal('window', { desktop: { readPetSheet: async () => ({ ok: true, data: { bytes: new Uint8Array(4), rows: 9 } }) } })
    vi.stubGlobal('document', document(sheet))
    vi.stubGlobal('createImageBitmap', async () => ({ width: sheet.width, height: sheet.height }))
    setPetLook(ref, undefined)
    await ensurePet(ref)
    const look = petLook(ref)
    return look.status === 'ready' ? look.atlas.screen : 'not ready'
  }

  it('gives him his screen when it is the sheet measured, and not when it is another', async () => {
    expect(await read(BUDDY, sheetLike(CODEX_BUDDY))).toBe(CODEX_BUDDY)
    expect(await read(BUDDY, sheetLike(CODEX_BUDDY, { row: 2, column: 4, by: EDGE_SLACK + 3 }))).toBeUndefined()
    // Another pet drawn the same is still not him.
    expect(await read(CAT, sheetLike(CODEX_BUDDY))).toBeUndefined()
  })
})

describe('a teammate wearing him', () => {
  it('wears the screen while Terminal faces is on, saying what he is doing', () => {
    setPetLook(BUDDY, { status: 'ready', atlas: atlas(CODEX_BUDDY) })
    const html = renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing(BUDDY)} size={44} activity="working" teammateId="tm_buddy" name="Buddy" />)
    expect(screened(html)).toBe(true)
    expect(html).toContain('data-pet="codex-buddy"')
    // Still a pet's face, with a teammate's hooks.
    expect(html).toContain('data-face="pet"')
    expect(html).toContain('data-pet-state="running"')
    expect(html).toContain('aria-label="Buddy"')
  })

  it('lifts everything he has as the face you talk to, and only standing beside a name', () => {
    setPetLook(BUDDY, { status: 'ready', atlas: atlas(CODEX_BUDDY) })
    const full = renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing(BUDDY)} size={96} activity="working" motion="full" />)
    const subtle = renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing(BUDDY)} size={34} activity="working" />)
    expect(full).toContain('data-move="workout"')
    expect(subtle).toContain('data-move="workout-standing"')
  })

  it('is drawn as his maker drew him with Terminal faces off, or when his teammate asks for that', () => {
    setPetLook(BUDDY, { status: 'ready', atlas: atlas(CODEX_BUDDY) })
    setTerminalFaces(false)
    expect(screened(renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing(BUDDY)} size={44} activity="working" />))).toBe(false)
    setTerminalFaces(true)
    expect(screened(renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing({ ...BUDDY, screen: false })} size={44} activity="working" />))).toBe(false)
    expect(screened(renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing({ ...BUDDY, screen: true })} size={44} activity="working" />))).toBe(true)
  })

  it('is drawn as he is when his sheet is not the one measured', () => {
    setPetLook(BUDDY, { status: 'ready', atlas: atlas() })
    const html = renderToStaticMarkup(<TeammateBot hue="blue" avatar={wearing(BUDDY)} size={44} activity="working" />)
    expect(html).toContain('data-pet="codex-buddy"')
    expect(screened(html)).toBe(false)
  })

  it('leaves every other pet as its maker drew it, even given a table', () => {
    setPetLook(CAT, { status: 'ready', atlas: atlas(CODEX_BUDDY) })
    expect(screened(renderToStaticMarkup(<TeammateBot hue="lime" avatar={wearing(CAT)} size={44} activity="working" />))).toBe(false)
  })
})

describe('his teammate’s look', () => {
  const open = (avatar: AvatarSpec): string =>
    renderToStaticMarkup(
      <NewTeammateDialog
        onCancel={() => undefined}
        onCreate={() => undefined}
        error={undefined}
        mode="accept-edits"
        initial={{ teammateId: 'tm_buddy', name: 'Buddy', hue: 'blue', role: 'Docs & QA', avatar, createdAt: '2026-10-05T00:00:00.000Z' }}
      />
    )
  const chosen = (html: string): string | undefined => /aria-checked="true" class="is-selected"[^>]*>(As drawn|Screen)</.exec(html)?.[1]

  it('offers his face as drawn or the screen, the screen until asked otherwise', () => {
    setPetLook(BUDDY, { status: 'ready', atlas: atlas(CODEX_BUDDY) })
    const html = open(wearing(BUDDY))
    expect(html).toContain('aria-label="Face"')
    expect(html).toContain('>As drawn<')
    expect(chosen(html)).toBe('Screen')
    expect(chosen(open(wearing({ ...BUDDY, screen: false })))).toBe('As drawn')
  })

  it('offers the screen only while Terminal faces is on, as a bot’s', () => {
    setPetLook(BUDDY, { status: 'ready', atlas: atlas(CODEX_BUDDY) })
    setTerminalFaces(false)
    const html = open(wearing(BUDDY))
    expect(chosen(html)).toBe('As drawn')
    expect(html).toMatch(/disabled=""[^>]*title="Turn Terminal faces on in Settings &gt; Appearance to give a teammate a screen."[^>]*>Screen</)
  })

  it('offers nothing for a pet with no screen measured, as before', () => {
    setPetLook(CAT, { status: 'ready', atlas: atlas() })
    expect(open(wearing(CAT))).not.toContain('aria-label="Face"')
  })

  it('keeps the choice with the teammate, and nothing else of the kind', () => {
    expect(isPetRef({ source: 'gallery', id: 'codex-buddy', screen: false })).toBe(true)
    expect(isPetRef({ source: 'gallery', id: 'codex-buddy', screen: 'no' })).toBe(false)
    const avatar = { ...seedAvatar('tm_buddy'), pet: { source: 'gallery', id: 'codex-buddy', screen: false } }
    expect(isAvatarSpec(avatar)).toBe(true)
    expect(cleanAvatar(avatar as AvatarSpec).pet).toEqual({ source: 'gallery', id: 'codex-buddy', screen: false })
    expect(cleanAvatar(wearing(BUDDY)).pet).toEqual({ source: 'gallery', id: 'codex-buddy' })
  })
})
