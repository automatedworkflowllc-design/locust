import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { columnName, csvWorkbook, looksNumeric, parseCsv, MAX_SHEET_ROWS } from '../shared/sheet.js'
import { WorkbookUnreadable, readXlsx } from './xlsx.js'

/**
 * A WORKBOOK IS READ FOR ITS CELLS (0.364).
 *
 * Penny built a budget workbook with openpyxl on her first suggestion, and
 * the viewer refused it: "Locust does not open that kind of file here" (the
 * Research & money drive, packaged 0.363). The fixture is written by the
 * same library (`test/workbooks/budget-openpyxl.xlsx`, openpyxl 3.1.5), so
 * the reader is held to a real writer's output, not only to this file's own.
 */
const fixture = readFileSync(new URL('../../test/workbooks/budget-openpyxl.xlsx', import.meta.url))

/** A zip of the given parts, deflated, for the cases no writer would produce. */
function zipOf(parts: Readonly<Record<string, string | Buffer>>, options: { readonly stored?: boolean; readonly claimSize?: number } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(parts)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const data = options.stored === true ? raw : deflateRawSync(raw)
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(options.stored === true ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(options.claimSize ?? raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(options.stored === true ? 0 : 8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(options.claimSize ?? raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(parts).length, 8)
  end.writeUInt16LE(Object.keys(parts).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const WORKBOOK = '<workbook xmlns:r="r"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>'
const RELS = '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'

const texts = (workbook: ReturnType<typeof readXlsx>, sheet = 0): string[][] => workbook.sheets[sheet]!.rows.map((row) => row.map((cell) => cell.text))

describe('a workbook openpyxl wrote', () => {
  const book = readXlsx(fixture)

  it('has its sheets, by name, in order', () => {
    expect(book.sheets.map((sheet) => sheet.name)).toEqual(['Monthly Budget', 'Notes'])
    expect(book.moreSheets).toBe(0)
  })

  it('reads text, numbers in their formats, a percent and a date', () => {
    const rows = texts(book)
    expect(rows[0]![0]).toBe('Monthly Budget')
    expect(rows[2]).toEqual(['Category', 'Budgeted', 'Actual'])
    expect(rows[3]).toEqual(['Salary', '$4,000.00', '4,000'])
    expect(rows[6]).toEqual(['Savings rate', '12.5%', ''])
    expect(rows[7]).toEqual(['Paid on', '2026-09-26', ''])
    // Entities decoded, and nothing in them becomes markup.
    expect(rows[8]![0]).toBe('Rent & utilities <shared>')
  })

  it('shows a formula with no stored result AS the formula, never a number it did not hold', () => {
    const cell = book.sheets[0]!.rows[5]![1]!
    expect(cell).toEqual({ text: '=SUM(B4:B5)', kind: 'formula' })
  })

  it('does not count a styled empty cell as content', () => {
    // Z20 is filled yellow and empty: no column Z, no row 20.
    expect(book.sheets[0]!.rows).toHaveLength(9)
    expect(book.sheets[0]!.rows[0]).toHaveLength(3)
    expect(book.sheets[0]!.moreColumns).toBe(0)
    expect(book.sheets[0]!.moreRows).toBe(0)
  })

  it('reads a boolean, on the second sheet', () => {
    expect(texts(book, 1)[1]).toEqual(['', 'TRUE'])
  })
})

describe('a workbook this does not trust', () => {
  it('shows a stored result where the file holds one', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>'
    const book = readXlsx(zipOf({ 'xl/workbook.xml': WORKBOOK, 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet1.xml': sheet }))
    expect(book.sheets[0]!.rows[0]![0]).toEqual({ text: '2', kind: 'number' })
  })

  it('refuses a part that claims more than it may inflate to, before inflating it', () => {
    const bomb = zipOf({ 'xl/workbook.xml': WORKBOOK }, { claimSize: 64 * 1024 * 1024 })
    expect(() => readXlsx(bomb)).toThrow(WorkbookUnreadable)
    // And one that lies about its size is still stopped by zlib's own cap.
    const liar = zipOf({ 'xl/workbook.xml': '<workbook>' + 'x'.repeat(30 * 1024 * 1024) + '</workbook>' }, { claimSize: 10 })
    expect(() => readXlsx(liar)).toThrow(/too large or damaged/)
  })

  it('says in words what it cannot read', () => {
    expect(() => readXlsx(Buffer.from('not a zip at all'))).toThrow(/not a workbook/)
    expect(() => readXlsx(zipOf({ 'word/document.xml': '<w/>' }))).toThrow(/not a workbook/)
  })

  it('draws at most the bound, and counts the rest', () => {
    const rows = Array.from({ length: MAX_SHEET_ROWS + 25 }, (_, index) => `<row r="${String(index + 1)}"><c r="A${String(index + 1)}" t="inlineStr"><is><t>r${String(index + 1)}</t></is></c></row>`).join('')
    const book = readXlsx(zipOf({ 'xl/workbook.xml': WORKBOOK, 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>` }))
    expect(book.sheets[0]!.rows).toHaveLength(MAX_SHEET_ROWS)
    expect(book.sheets[0]!.moreRows).toBe(25)
  })
})

describe('a CSV', () => {
  it('reads quoted fields, doubled quotes and line breaks inside them', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3']
    ])
  })

  it('becomes a one-sheet workbook with its numbers set right', () => {
    const book = csvWorkbook('budget.csv', 'Category,Budgeted\nRent,"1,400"\nFood,$500.00\n', ',')
    expect(book.sheets[0]!.name).toBe('budget.csv')
    expect(book.sheets[0]!.rows[1]).toEqual([
      { text: 'Rent', kind: 'text' },
      { text: '1,400', kind: 'number' }
    ])
    expect(book.sheets[0]!.rows[2]![1]!.kind).toBe('number')
  })

  it('reads a TSV the same way', () => {
    expect(csvWorkbook('a.tsv', 'x\ty\n1\t2', '\t').sheets[0]!.rows[1]!.map((cell) => cell.text)).toEqual(['1', '2'])
  })
})

describe('a spreadsheet\'s own words', () => {
  it('names columns the way a spreadsheet does', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('knows a number when it sees one written', () => {
    for (const text of ['1', '-3.5', '1,400', '$4,200.00', '12%', '(250)']) expect(looksNumeric(text)).toBe(true)
    for (const text of ['Rent', '1,40', '12 apples', '2026-09-26', '']) expect(looksNumeric(text)).toBe(false)
  })
})
