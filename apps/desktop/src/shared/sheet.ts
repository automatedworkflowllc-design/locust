/**
 * A SPREADSHEET, READ -- never run (0.364).
 *
 * Penny, the keeper of the numbers in Research & money, built a budget
 * workbook on her first suggestion -- ten categories, twenty-one formulas --
 * and pressing it said "Locust does not open that kind of file here" (the
 * Research & money drive, packaged 0.363). Colin: "it could also show in a
 * viewer or as an artifact like Claude code does".
 *
 * It shows in the viewer now, as a grid a spreadsheet person recognises:
 * column letters, row numbers, a tab per sheet. It is READ, the way a
 * document is: the host takes the cell values out of the file and the
 * renderer draws them as escaped text. No formula is worked out and nothing
 * in the file runs (DECISION-2026-09-20) -- a formula whose result the file
 * does not already hold is shown as the formula, which is exactly what the
 * file says.
 *
 * Bounded everywhere, and each bound is said on screen rather than hidden:
 * rows, columns, sheets and a cell's length.
 */

export type SheetCellKind = 'text' | 'number' | 'formula' | 'boolean' | 'error'

export interface SheetCell {
  readonly text: string
  /** Numbers sit right, a formula with no stored result is drawn as one. */
  readonly kind: SheetCellKind
}

export interface SheetTable {
  readonly name: string
  /** Rows of cells, trailing empty rows and columns trimmed. */
  readonly rows: readonly (readonly SheetCell[])[]
  /** Rows past the bound, counted and not drawn. */
  readonly moreRows: number
  /** Columns past the bound, counted and not drawn. */
  readonly moreColumns: number
}

export interface Workbook {
  readonly sheets: readonly SheetTable[]
  /** Sheets past the bound. */
  readonly moreSheets: number
}

export const MAX_SHEET_ROWS = 500
export const MAX_SHEET_COLUMNS = 40
export const MAX_SHEETS = 12
export const MAX_CELL_TEXT = 300

/** The spreadsheet files the viewer reads, by extension. */
export const SHEET_EXTENSIONS: ReadonlySet<string> = new Set(['csv', 'tsv', 'xlsx'])

/** `A` for 0, `Z` for 25, `AA` for 26: a spreadsheet's own column names. */
export function columnName(index: number): string {
  let name = ''
  let rest = index + 1
  while (rest > 0) {
    const digit = (rest - 1) % 26
    name = String.fromCharCode(65 + digit) + name
    rest = Math.floor((rest - 1) / 26)
  }
  return name
}

/** `B6` -> column 1 (zero-based), or undefined for anything that is not a cell reference. */
export function columnOfReference(reference: string): number | undefined {
  const letters = /^([A-Z]{1,3})\d+$/.exec(reference.trim().toUpperCase())?.[1]
  if (letters === undefined) return undefined
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

/** A cell's text as it will be drawn: bounded, and never a control character. */
export function cellText(value: string): string {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return clean.length > MAX_CELL_TEXT ? `${clean.slice(0, MAX_CELL_TEXT - 1)}…` : clean
}

/**
 * Whether written text reads as a number -- `1,400`, `-3.5`, `$4,200.00`,
 * `12%` -- so it sits right, the way a spreadsheet draws it.
 */
export function looksNumeric(text: string): boolean {
  return /^[-+(]?[$€£¥]?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?%?$/.test(text.trim())
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes inside them, line breaks inside
 * quotes, CRLF or LF. Stops reading once it has more rows than it will draw,
 * so a huge file costs what the viewer shows, not what it holds.
 */
export function parseCsv(text: string, delimiter: ',' | '\t' = ',', limitRows = MAX_SHEET_ROWS + 1): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  while (index < body.length) {
    const char = body[index]!
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"' && field.length === 0) {
      quoted = true
      index += 1
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (char === '\r' || char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += char === '\r' && body[index + 1] === '\n' ? 2 : 1
      if (rows.length >= limitRows) return rows
      continue
    }
    field += char
    index += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * Trailing empty rows and columns off, bounds applied and counted.
 *
 * `knownRows` and `knownColumns` are how many rows and columns HOLD
 * something in the whole source, when the grid is already cut to the bound
 * -- so "N more" counts what is there, not what merely has a style.
 */
export function boundedTable(name: string, grid: readonly (readonly SheetCell[])[], knownRows?: number, knownColumns?: number): SheetTable {
  let last = grid.length
  while (last > 0 && grid[last - 1]!.every((cell) => cell.text.length === 0)) last -= 1
  const kept = grid.slice(0, last)
  let width = 0
  for (const row of kept) {
    let end = row.length
    while (end > 0 && row[end - 1]!.text.length === 0) end -= 1
    width = Math.max(width, end)
  }
  const drawnWidth = Math.min(width, MAX_SHEET_COLUMNS)
  const drawnRows = kept.slice(0, MAX_SHEET_ROWS).map((row) =>
    Array.from({ length: drawnWidth }, (_, column) => row[column] ?? { text: '', kind: 'text' as const })
  )
  return {
    name,
    rows: drawnRows,
    moreRows: Math.max(0, (knownRows ?? kept.length) - drawnRows.length),
    moreColumns: Math.max(0, Math.max(width, knownColumns ?? 0) - drawnWidth)
  }
}

/** A CSV or TSV file as a one-sheet workbook, named after the file. */
export function csvWorkbook(name: string, text: string, delimiter: ',' | '\t'): Workbook {
  const parsed = parseCsv(text, delimiter)
  // Rows past the ones parsed are counted from the line breaks left over --
  // an estimate only when a quoted field holds a line break, and said as one.
  const moreLines = parsed.length > MAX_SHEET_ROWS ? Math.max(0, text.split('\n').length - parsed.length) : 0
  const grid = parsed.map((row) =>
    row.map((value): SheetCell => {
      const text = cellText(value)
      return { text, kind: looksNumeric(text) ? 'number' : 'text' }
    })
  )
  return { sheets: [boundedTable(name, grid, grid.length + moreLines)], moreSheets: 0 }
}
