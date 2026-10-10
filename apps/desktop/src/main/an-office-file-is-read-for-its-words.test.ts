import { readFileSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { MAX_DOCUMENT_TABLE_ROWS } from '../shared/office-document.js'
import { readDocx, readPptx } from './office-text.js'
import { WorkbookUnreadable } from './xlsx.js'

/**
 * A WORD OR POWERPOINT FILE IS READ FOR ITS WORDS (0.517).
 *
 * The .docx or .pptx a teammate makes is the deliverable for someone who is
 * not a programmer, and pressing one said "Locust does not open that kind of
 * file here". The fixtures are written by python-docx 1.2.0 and python-pptx
 * 1.0.2 (`test/documents/`), the libraries a teammate reaches for, so the
 * reader is held to a real writer's output.
 */
const report = readFileSync(new URL('../../test/documents/report-python-docx.docx', import.meta.url))
const deck = readFileSync(new URL('../../test/documents/deck-python-pptx.pptx', import.meta.url))

/** A zip of the given parts, deflated, for the cases no writer would produce. */
function zipOf(parts: Readonly<Record<string, string>>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(parts)) {
    const raw = Buffer.from(content, 'utf8')
    const data = deflateRawSync(raw)
    const nameBytes = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
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

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

describe('a Word document python-docx wrote', () => {
  const read = readDocx(report)

  it('has its title, headings, paragraphs, list items and table, in order', () => {
    expect(read.kind).toBe('word')
    expect(read.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Quarterly Report' },
      { kind: 'paragraph', text: 'Revenue grew in every region. Costs held flat at $5 per unit; see <the table> & *notes*.' },
      { kind: 'heading', level: 1, text: 'Highlights' },
      { kind: 'item', depth: 0, text: 'New customers in the north' },
      { kind: 'item', depth: 0, text: 'Two hires, both engineers' },
      { kind: 'item', depth: 1, text: 'One of them in support' },
      { kind: 'heading', level: 2, text: 'By region' },
      { kind: 'table', rows: [['Region', 'Q2', 'Q3'], ['North', '120', '150'], ['South', '90', '95']] },
      { kind: 'paragraph', text: 'Prepared by the finance teammate.' }
    ])
    expect(read.more).toBe(0)
  })

  it('keeps the characters a model might write exactly as written: nothing is markup', () => {
    const paragraph = read.blocks.find((block) => block.kind === 'paragraph')
    expect(paragraph).toEqual(expect.objectContaining({ text: expect.stringContaining('<the table> & *notes*') }))
  })
})

describe('a deck python-pptx wrote', () => {
  const read = readPptx(deck)

  it('has each slide, numbered, under its title, with its text and table', () => {
    expect(read.kind).toBe('slides')
    expect(read.blocks).toEqual([
      { kind: 'slide', number: 1, title: 'Launch Plan' },
      { kind: 'paragraph', text: 'October 2026' },
      { kind: 'slide', number: 2, title: 'What ships' },
      { kind: 'item', depth: 0, text: 'Weekday routines' },
      { kind: 'item', depth: 1, text: 'Monday to Friday by default' },
      { kind: 'item', depth: 0, text: 'Word and PowerPoint previews' },
      { kind: 'slide', number: 3, title: 'Numbers' },
      { kind: 'table', rows: [['Metric', 'Value'], ['Users', '1,200']] },
      { kind: 'paragraph', text: 'Source: the usage export' }
    ])
  })
})

describe('what is not drawn, and what is refused', () => {
  it('leaves out deleted text, field codes and empty paragraphs; a tab stays a tab', () => {
    const xml = `<w:document ${W}><w:body>
      <w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:tab/><w:t xml:space="preserve">after a tab</w:t></w:r></w:p>
      <w:p/>
      <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Tab stops are not tabs</w:t></w:r></w:p>
    </w:body></w:document>`
    expect(readDocx(zipOf({ 'word/document.xml': xml })).blocks).toEqual([
      { kind: 'paragraph', text: 'Kept\tafter a tab' },
      { kind: 'paragraph', text: 'Tab stops are not tabs' }
    ])
  })

  it('reads an empty run as nothing, not as the XML after it (2026-10-10 sweep)', () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:t/></w:r><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>`
    expect(readDocx(zipOf({ 'word/document.xml': xml })).blocks).toEqual([{ kind: 'paragraph', text: 'Hello' }])
  })

  it('reads a table inside a table cell without losing the paragraphs after it', () => {
    const cell = (text: string): string => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
    const inner = `<w:tbl><w:tr>${cell('inner')}</w:tr></w:tbl>`
    const xml = `<w:document ${W}><w:body><w:tbl><w:tr>${cell('a')}<w:tc>${inner}<w:p/></w:tc></w:tr></w:tbl><w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>`
    const blocks = readDocx(zipOf({ 'word/document.xml': xml })).blocks
    expect(blocks[blocks.length - 1]).toEqual({ kind: 'paragraph', text: 'After' })
  })

  it('a long table keeps its first rows and says how many it has', () => {
    const rows = Array.from({ length: MAX_DOCUMENT_TABLE_ROWS + 5 }, (_, index) => `<w:tr><w:tc><w:p><w:r><w:t>${String(index)}</w:t></w:r></w:p></w:tc></w:tr>`).join('')
    const blocks = readDocx(zipOf({ 'word/document.xml': `<w:document ${W}><w:body><w:tbl>${rows}</w:tbl></w:body></w:document>` })).blocks
    expect(blocks[0]).toEqual(expect.objectContaining({ kind: 'table' }))
    expect(blocks[0]?.kind === 'table' ? blocks[0].rows.length : 0).toBe(MAX_DOCUMENT_TABLE_ROWS)
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: `(This table has ${String(MAX_DOCUMENT_TABLE_ROWS + 5)} rows and 1 columns; the first ${String(MAX_DOCUMENT_TABLE_ROWS)} rows and 1 columns are shown.)` })
  })

  it('a file that is not a zip, or a zip with no document in it, is refused in words', () => {
    expect(() => readDocx(Buffer.from('not a zip at all'))).toThrow(WorkbookUnreadable)
    expect(() => readDocx(Buffer.from('not a zip at all'))).toThrow('That file is not a Word document Locust can read.')
    expect(() => readPptx(zipOf({ 'word/document.xml': '<w:document/>' }))).toThrow('That file is not a presentation Locust can read.')
    // A workbook handed in as a deck is not read as one.
    expect(() => readDocx(zipOf({ 'xl/workbook.xml': '<workbook/>' }))).toThrow(WorkbookUnreadable)
  })

  it('a slide\'s number, date and footer are left out', () => {
    const presentation = '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>'
    const rels = '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>'
    const shape = (type: string, text: string): string => `<p:sp><p:nvSpPr><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
    const slide = `<p:sld><p:cSld><p:spTree>${shape('title', 'Only this')}${shape('sldNum', '7')}${shape('dt', '10/1/2026')}${shape('ftr', 'Confidential')}</p:spTree></p:cSld></p:sld>`
    expect(readPptx(zipOf({ 'ppt/presentation.xml': presentation, 'ppt/_rels/presentation.xml.rels': rels, 'ppt/slides/slide1.xml': slide })).blocks).toEqual([
      { kind: 'slide', number: 1, title: 'Only this' }
    ])
  })
})
