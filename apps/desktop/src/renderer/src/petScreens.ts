import { PET_COLUMNS } from '../../shared/pets.js'

/**
 * A PET WITH A SCREEN FOR A FACE (2026-10-05).
 *
 * Colin, of Codex Buddy, one of the pets he kept (shared/pet-picks.ts): *"do
 * you think you could make a new animation for him where he has the terminal
 * face and maybe has more lifting animations?"* -- and, shown him with a
 * screen where his face is: *"yeah i love your idea build it, we can figure
 * out a way to cycle in all his lifting animations as well"*.
 *
 * 0.563 kept the new eyes to Locust's own bots (*"we cant do our eyes on the
 * new pets"*): a pet's face is drawn into each of its drawings. But a pet
 * whose every drawing has been looked at can wear one. Its drawings stay its
 * maker's, and Locust ships none of them: it downloads one when a person picks
 * it. So the screen is not painted into his sheet. Locust draws it over his
 * face as each drawing is shown, from where his face is in each of his 57
 * drawings -- numbers, measured once from his sheet
 * (`_tools/measure-buddy-screen.py`) and every one looked at. The screen and
 * its eyes are Locust's own: the bots' glyphs, their light, their changes
 * (PetSprite's screen).
 *
 * THE TABLE IS FOR HIS SHEET, AND NO OTHER. A pet's maker may change it, and
 * another pet may share his id, so before a screen goes on, his sheet is
 * checked against the one measured (`screenFits`): each drawing's painted
 * left and right edges, which a re-compressed copy keeps and a redrawn one
 * does not (his maker's art fills every frame top to bottom, so the sides are
 * where a drawing says what it is). A sheet that does not fit is drawn as it
 * is, its own face: never a screen in the wrong place.
 */

/** Where a screen goes on one drawing: its glass, in the drawing's own pixels (192 x 208). */
export interface ScreenRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * What a sheet is checked by (screenFits): its drawings' size, how many each
 * row has, and each drawing's painted edges -- its left and the column after
 * its right, or (petPuppets.ts) its left, top, right and the row after its
 * bottom, for a maker who fills every drawing edge to edge, whose sides
 * alone say little.
 */
export interface SheetPrint {
  /** The size of one drawing, in the sheet's pixels. */
  readonly frameWidth: number
  readonly frameHeight: number
  /** How many drawings each row has. */
  readonly counts: readonly number[]
  readonly edges: readonly (readonly (readonly number[])[])[]
}

export interface PetScreenFace extends SheetPrint {
  readonly id: string
  /** The glass's tint (Bot's visor takes a body's colour the same way): his cap's blue. */
  readonly glass: string
  /** Round the glass, as wide as his own lines: his ink. */
  readonly ink: string
  /** The screen on each drawing, by row and column. */
  readonly cells: readonly (readonly (readonly [x: number, y: number, w: number, h: number])[])[]
  /** Each drawing's painted left edge and the column after its right one (alpha over half): what his sheet is checked by. */
  readonly edges: readonly (readonly (readonly [left: number, right: number])[])[]
}

/**
 * CODEX BUDDY (openpets.dev, by his maker): a gym buddy in a blue cap and star
 * shorts, nine rows of drawings. Measured 2026-10-05 from his sheet as
 * Locust downloaded it, and looked at drawing by drawing
 * (docs/FINDING-codex-buddy-screen.md). He faces you in most rows, turns
 * right and left as he walks (rows 1 and 2), sits on a bench in row 5, and
 * ducks his head between his arms hanging from the bar and pressing overhead.
 * One screen size for each way he faces, so it holds its size as he moves.
 */
export const CODEX_BUDDY: PetScreenFace = {
  id: 'codex-buddy',
  frameWidth: 192,
  frameHeight: 208,
  counts: [6, 8, 8, 4, 5, 8, 6, 6, 6],
  glass: '#126dc7',
  ink: '#0c080d',
  cells: [
    [[71, 44, 37, 27], [72, 44, 37, 27], [72, 44, 37, 27], [72, 44, 37, 27], [73, 44, 37, 27], [72, 44, 37, 27]],
    [[98, 52, 37, 30], [98, 52, 37, 30], [101, 54, 37, 30], [92, 50, 37, 30], [98, 52, 37, 30], [100, 54, 37, 30], [91, 51, 37, 30], [98, 52, 37, 30]],
    [[58, 52, 37, 30], [56, 54, 37, 30], [52, 55, 37, 30], [56, 52, 37, 30], [56, 53, 37, 30], [56, 54, 37, 30], [56, 52, 37, 30], [51, 54, 37, 30]],
    [[76, 44, 37, 27], [76, 44, 37, 27], [76, 44, 37, 27], [69, 44, 37, 27]],
    [[74, 70, 32, 23], [72, 44, 37, 27], [73, 44, 37, 27], [72, 44, 37, 27], [74, 70, 31, 23]],
    [[77, 46, 39, 31], [80, 48, 39, 31], [86, 46, 39, 31], [85, 46, 39, 31], [80, 46, 39, 31], [83, 47, 39, 31], [86, 47, 39, 31], [80, 48, 39, 31]],
    [[68, 47, 37, 27], [70, 48, 37, 27], [64, 55, 44, 32], [76, 46, 37, 27], [75, 48, 37, 27], [75, 47, 37, 27]],
    [[72, 53, 37, 27], [75, 50, 37, 27], [74, 50, 37, 27], [78, 69, 31, 25], [70, 52, 37, 27], [72, 53, 37, 27]],
    [[69, 48, 37, 27], [79, 49, 37, 27], [76, 48, 37, 27], [80, 46, 37, 27], [77, 49, 37, 27], [70, 48, 37, 27]]
  ],
  edges: [
    [[33, 158], [33, 159], [34, 158], [34, 157], [35, 157], [34, 158]],
    [[33, 159], [36, 155], [10, 182], [40, 151], [36, 156], [17, 175], [42, 150], [34, 157]],
    [[39, 152], [34, 157], [10, 181], [42, 149], [31, 160], [38, 153], [40, 151], [41, 151]],
    [[32, 160], [33, 158], [33, 159], [40, 152]],
    [[42, 149], [18, 173], [19, 172], [19, 173], [42, 149]],
    [[13, 178], [6, 186], [9, 182], [11, 181], [13, 179], [12, 179], [10, 181], [13, 179]],
    [[33, 159], [36, 155], [17, 174], [28, 164], [28, 164], [29, 163]],
    [[35, 156], [21, 170], [24, 168], [43, 148], [21, 170], [34, 158]],
    [[34, 158], [30, 161], [31, 161], [30, 162], [29, 162], [32, 159]]
  ]
}

const FACES: readonly PetScreenFace[] = [CODEX_BUDDY]

/** The screen measured for a pet of this id, before its sheet is checked (`screenFits`); undefined for most pets. */
export function screenFaceFor(id: string): PetScreenFace | undefined {
  return FACES.find((face) => face.id === id)
}

/** How far a drawing's edge may sit from the one measured: a re-compressed sheet's are where they were (checked at WebP quality 75). */
export const EDGE_SLACK = 2

/**
 * Whether a sheet is the one the screen was measured on: its size, and every
 * drawing's painted edges within EDGE_SLACK of the table's. `data` is the
 * whole sheet's pixels, `width` across.
 */
export function screenFits(face: SheetPrint, data: Uint8ClampedArray, width: number, height: number): boolean {
  if (width !== face.frameWidth * PET_COLUMNS || height !== face.frameHeight * 9) return false
  for (let row = 0; row < face.counts.length; row += 1) {
    const count = face.counts[row] ?? 0
    for (let column = 0; column < PET_COLUMNS; column += 1) {
      const want = column < count ? face.edges[row]?.[column] : undefined
      const left = column * face.frameWidth
      const top = row * face.frameHeight
      const found =
        want !== undefined && want.length === 4
          ? paintedBox(data, width, left, top, face.frameWidth, face.frameHeight)
          : paintedEdges(data, width, left, top, face.frameWidth, face.frameHeight)
      // A drawing where the table has none, or none where it has one: not the sheet measured.
      if ((want === undefined) !== (found === undefined)) return false
      if (want === undefined || found === undefined) continue
      if (want.some((edge, i) => Math.abs((found[i] ?? Number.NaN) - edge) > EDGE_SLACK || Number.isNaN(found[i] ?? Number.NaN))) return false
    }
  }
  return true
}

/** A drawing's painted left, top, right and bottom: the first column and row with paint, and the ones after the last; undefined when empty. */
export function paintedBox(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  frameWidth: number,
  frameHeight: number
): readonly [number, number, number, number] | undefined {
  const sides = paintedEdges(data, width, left, top, frameWidth, frameHeight)
  if (sides === undefined) return undefined
  const painted = (y: number): boolean => {
    for (let x = sides[0]; x < sides[1]; x += 1) {
      if ((data[((top + y) * width + left + x) * 4 + 3] ?? 0) > 128) return true
    }
    return false
  }
  let first = 0
  while (first < frameHeight && !painted(first)) first += 1
  let last = frameHeight - 1
  while (last > first && !painted(last)) last -= 1
  return [sides[0], first, sides[1], last + 1]
}

/** A drawing's painted left edge and the column after its right one (alpha over half), or undefined when it is empty. */
export function paintedEdges(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  frameWidth: number,
  frameHeight: number
): readonly [number, number] | undefined {
  const painted = (x: number): boolean => {
    for (let y = top; y < top + frameHeight; y += 1) {
      if ((data[(y * width + left + x) * 4 + 3] ?? 0) > 128) return true
    }
    return false
  }
  let first = 0
  while (first < frameWidth && !painted(first)) first += 1
  if (first === frameWidth) return undefined
  let last = frameWidth - 1
  while (last > first && !painted(last)) last -= 1
  return [first, last + 1]
}

/** The screen on one drawing, or undefined where the table has none. */
export function screenAt(face: PetScreenFace, row: number, column: number): ScreenRect | undefined {
  const cell = face.cells[row]?.[column]
  if (cell === undefined) return undefined
  const [x, y, w, h] = cell
  return { x, y, w, h }
}
