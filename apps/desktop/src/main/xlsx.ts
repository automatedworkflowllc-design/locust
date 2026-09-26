import { inflateRawSync } from 'node:zlib'

import { MAX_SHEETS, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, boundedTable, cellText, columnOfReference } from '../shared/sheet.js'
import type { SheetCell, Workbook } from '../shared/sheet.js'

/**
 * AN .XLSX, READ FOR ITS CELLS (0.364).
 *
 * What the viewer needs from a workbook a teammate made: each sheet's name
 * and the values in its cells. An .xlsx is a zip of XML parts, and reading
 * those takes a zip directory, `inflateRaw` from Node's own zlib, and the
 * handful of elements a cell is made of -- no dependency, and nothing that
 * could run. Macros live in .xlsm, which is not read; formulas are never
 * worked out, only their stored results shown, or the formula itself when
 * the file holds no result (openpyxl, which Penny used, never stores one).
 *
 * Hostile input is the ordinary case -- a model wrote this file -- so every
 * size is checked before it is spent: entries, each part's inflated size
 * (zlib stops at the cap), and what the grid may hold. A file this cannot
 * read is refused in words, never half drawn as though it were whole.
 */

/** A part may inflate to at most this. A zip bomb stops here, not in memory. */
const MAX_PART_BYTES = 24 * 1024 * 1024
const MAX_ENTRIES = 4_000

export class WorkbookUnreadable extends Error {}

interface ZipEntry {
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localOffset: number
}

/** The zip's directory: name -> where its bytes are. */
function zipDirectory(bytes: Buffer): ReadonlyMap<string, ZipEntry> {
  // The end-of-directory record sits in the last 64 KB + 22 bytes.
  const floor = Math.max(0, bytes.length - 65_557)
  let end = -1
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (bytes.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new WorkbookUnreadable('That file is not a workbook Locust can read.')
  const count = bytes.readUInt16LE(end + 10)
  const directoryOffset = bytes.readUInt32LE(end + 16)
  if (count > MAX_ENTRIES || directoryOffset === 0xffffffff) throw new WorkbookUnreadable('That workbook is too large to show here.')
  const entries = new Map<string, ZipEntry>()
  let at = directoryOffset
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) throw new WorkbookUnreadable('That workbook is damaged.')
    const method = bytes.readUInt16LE(at + 10)
    const compressedSize = bytes.readUInt32LE(at + 20)
    const uncompressedSize = bytes.readUInt32LE(at + 24)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extraLength = bytes.readUInt16LE(at + 30)
    const commentLength = bytes.readUInt16LE(at + 32)
    const localOffset = bytes.readUInt32LE(at + 42)
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength)
    entries.set(name.replace(/\\/g, '/'), { method, compressedSize, uncompressedSize, localOffset })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** One part's text, or undefined when the workbook has no such part. */
function partText(bytes: Buffer, entries: ReadonlyMap<string, ZipEntry>, name: string): string | undefined {
  const entry = entries.get(name.replace(/^\//, ''))
  if (entry === undefined) return undefined
  if (entry.uncompressedSize > MAX_PART_BYTES) throw new WorkbookUnreadable('That workbook is too large to show here.')
  const local = entry.localOffset
  if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new WorkbookUnreadable('That workbook is damaged.')
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return data.toString('utf8')
  if (entry.method !== 8) throw new WorkbookUnreadable('That workbook is packed in a way Locust does not read.')
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString('utf8')
  } catch {
    throw new WorkbookUnreadable('That workbook is too large or damaged to show here.')
  }
}

/** The five XML entities and numeric references. No DTD is ever read, so nothing expands. */
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (whole, name: string) => {
    if (name === 'lt') return '<'
    if (name === 'gt') return '>'
    if (name === 'amp') return '&'
    if (name === 'quot') return '"'
    if (name === 'apos') return "'"
    const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

/** An attribute's value from an element's attribute text. */
function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}="([^"]*)"`).exec(attributes)
  return match?.[1] === undefined ? undefined : decodeXml(match[1])
}

/** Every `<t>` inside a fragment, joined: a plain string, or a rich one in runs. */
function textRuns(fragment: string): string {
  let text = ''
  for (const match of fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) text += decodeXml(match[1] ?? '')
  return text
}

const BUILTIN_DATE_FORMATS: ReadonlySet<number> = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
const BUILTIN_FORMATS: Readonly<Record<number, string>> = { 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%' }

/** How a style shows a number: as a date, or with its decimals, grouping, percent and currency sign. */
interface NumberStyle {
  readonly date: boolean
  readonly format?: string
}

function stylesOf(xml: string | undefined): readonly NumberStyle[] {
  if (xml === undefined) return []
  const custom = new Map<number, string>()
  for (const match of xml.matchAll(/<(?:\w+:)?numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attribute(match[1] ?? '', 'numFmtId'))
    const code = attribute(match[1] ?? '', 'formatCode')
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code)
  }
  const cellXfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml)?.[1] ?? ''
  const styles: NumberStyle[] = []
  for (const match of cellXfs.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attribute(match[1] ?? '', 'numFmtId') ?? '0')
    const code = custom.get(id) ?? BUILTIN_FORMATS[id]
    // A custom format is a date when, outside its quoted text and [colour]
    // sections, it names a year or a day -- or a month, with no hour or
    // second beside it to make that `m` a minute.
    const bare = (code ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
    const date = BUILTIN_DATE_FORMATS.has(id) || /[yd]/i.test(bare) || (/m/i.test(bare) && !/[hs]/i.test(bare))
    styles.push({ date, ...(code === undefined ? {} : { format: code }) })
  }
  return styles
}

/** An Excel date serial as a date a person reads: 2026-09-26, with the time when it has one. */
function excelDate(serial: number, from1904: boolean): string {
  const epoch = from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const at = new Date(epoch + Math.round(serial * 86_400_000))
  const day = at.toISOString().slice(0, 10)
  const time = at.toISOString().slice(11, 16)
  return serial % 1 === 0 || time === '00:00' ? day : `${day} ${time}`
}

/** A number the way its style asks, within reason: decimals, thousands, percent, a currency sign. */
function formatNumber(value: number, format: string | undefined): string {
  if (format === undefined || format === 'General') return String(Number(value.toPrecision(12)))
  const section = format.split(';')[0] ?? ''
  const bare = section.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  const percent = bare.includes('%')
  const decimals = /\.(0+)/.exec(bare)?.[1]?.length ?? 0
  const grouped = bare.includes(',')
  const sign = /[$€£¥]/.exec(section)?.[0]
  const shown = percent ? value * 100 : value
  const digits = Math.abs(shown).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })
  const body = `${sign ?? ''}${digits}${percent ? '%' : ''}`
  return shown < 0 ? `-${body}` : body
}

/**
 * The workbook's sheets, each as the grid the viewer draws.
 *
 * Throws `WorkbookUnreadable`, with a sentence for the person, for anything
 * it will not draw.
 */
export function readXlsx(bytes: Buffer): Workbook {
  const entries = zipDirectory(bytes)
  const workbookXml = partText(bytes, entries, 'xl/workbook.xml')
  if (workbookXml === undefined) throw new WorkbookUnreadable('That file is not a workbook Locust can read.')
  const from1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbookXml)
  const rels = partText(bytes, entries, 'xl/_rels/workbook.xml.rels') ?? ''
  const targets = new Map<string, string>()
  for (const match of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1] ?? '', 'Id')
    const target = attribute(match[1] ?? '', 'Target')
    if (id !== undefined && target !== undefined) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const shared: string[] = []
  const sharedXml = partText(bytes, entries, 'xl/sharedStrings.xml')
  if (sharedXml !== undefined) {
    for (const match of sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)) shared.push(textRuns(match[1] ?? ''))
  }
  const styles = stylesOf(partText(bytes, entries, 'xl/styles.xml'))

  const listed = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)].map((match) => ({
    name: attribute(match[1] ?? '', 'name') ?? 'Sheet',
    id: attribute(match[1] ?? '', 'id')
  }))
  const sheets = listed.slice(0, MAX_SHEETS).map(({ name, id }) => {
    const target = id === undefined ? undefined : targets.get(id)
    const xml = target === undefined ? undefined : partText(bytes, entries, target)
    if (xml === undefined) return boundedTable(cellText(name), [])
    const grid: SheetCell[][] = []
    // Rows and columns that HOLD something -- a styled empty cell is not
    // content, and must not make the grid say it has more than it shows.
    let rowCount = 0
    let columnCount = 0
    let nextRow = 0
    const HOLDS = /<(?:\w+:)?(?:v|f|is)\b/
    for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const numbered = Number(attribute(rowMatch[1] ?? '', 'r'))
      const rowIndex = Number.isFinite(numbered) && numbered > 0 ? numbered - 1 : nextRow
      nextRow = rowIndex + 1
      const body = rowMatch[2] ?? ''
      if (HOLDS.test(body)) rowCount = Math.max(rowCount, rowIndex + 1)
      if (rowIndex >= MAX_SHEET_ROWS) continue
      const row: SheetCell[] = []
      let nextColumn = 0
      for (const cellMatch of body.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attributes = cellMatch[1] ?? ''
        const inner = cellMatch[2] ?? ''
        const column = columnOfReference(attribute(attributes, 'r') ?? '') ?? nextColumn
        nextColumn = column + 1
        if (HOLDS.test(inner)) columnCount = Math.max(columnCount, column + 1)
        if (column >= MAX_SHEET_COLUMNS) continue
        const type = attribute(attributes, 't')
        const value = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1]
        const formula = /<(?:\w+:)?f\b[^>]*>([\s\S]*?)<\/(?:\w+:)?f>/.exec(inner)?.[1]
        let cell: SheetCell
        if (type === 's') cell = { text: cellText(shared[Number(value)] ?? ''), kind: 'text' }
        else if (type === 'inlineStr') cell = { text: cellText(textRuns(inner)), kind: 'text' }
        else if (type === 'b') cell = { text: value === '1' ? 'TRUE' : 'FALSE', kind: 'boolean' }
        else if (type === 'e') cell = { text: cellText(decodeXml(value ?? '#ERROR')), kind: 'error' }
        else if (type === 'str') cell = value === undefined && formula !== undefined ? { text: cellText(`=${decodeXml(formula)}`), kind: 'formula' } : { text: cellText(decodeXml(value ?? '')), kind: 'text' }
        else if (value === undefined || value.trim() === '') {
          cell = formula === undefined ? { text: '', kind: 'text' } : { text: cellText(`=${decodeXml(formula)}`), kind: 'formula' }
        } else {
          const number = Number(value)
          const style = styles[Number(attribute(attributes, 's') ?? '0')] ?? { date: false }
          cell = !Number.isFinite(number)
            ? { text: cellText(decodeXml(value)), kind: 'text' }
            : style.date
              ? { text: excelDate(number, from1904), kind: 'number' }
              : { text: formatNumber(number, style.format), kind: 'number' }
        }
        row[column] = cell
      }
      grid[rowIndex] = row
    }
    const dense = Array.from({ length: Math.min(rowCount, MAX_SHEET_ROWS) }, (_, index) =>
      Array.from({ length: grid[index]?.length ?? 0 }, (_, column) => grid[index]?.[column] ?? { text: '', kind: 'text' as const })
    )
    return boundedTable(cellText(name), dense, rowCount, columnCount)
  })
  return { sheets, moreSheets: Math.max(0, listed.length - MAX_SHEETS) }
}
