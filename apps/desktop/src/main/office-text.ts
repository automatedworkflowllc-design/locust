import { MAX_DOCUMENT_BLOCKS, MAX_DOCUMENT_TABLE_COLUMNS, MAX_DOCUMENT_TABLE_ROWS, documentText } from '../shared/office-document.js'
import type { DocumentBlock, OfficeDocument } from '../shared/office-document.js'
import { WorkbookUnreadable, attribute, decodeXml, partText, zipDirectory } from './xlsx.js'

/**
 * A .DOCX OR .PPTX, READ FOR ITS WORDS (0.517).
 *
 * Both are zips of XML parts, like an .xlsx (xlsx.ts, whose zip reader this
 * shares): the words are in `<w:t>` (Word) and `<a:t>` (PowerPoint), and
 * what a paragraph is -- a heading, a list item -- is in its properties. No
 * dependency and nothing that could run; hostile input is the ordinary case,
 * so every bound is checked (shared/office-document.ts) and a file this
 * cannot read is refused in words.
 */

const WORD = 'Word document'
const SLIDES = 'presentation'

/** Where an element that may nest (a table in a table) closes: the index after its end tag. */
function closingAt(xml: string, tag: string, from: number): number {
  const pattern = new RegExp(`<${tag}\\b[^>]*?(/)?>|</${tag}>`, 'g')
  pattern.lastIndex = from
  let depth = 1
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    if (match[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return pattern.lastIndex
    } else if (match[1] !== '/') depth += 1
  }
  return xml.length
}

/** The paragraphs and tables directly in a Word body or cell, in order. */
function wordChildren(xml: string): { readonly kind: 'p' | 'tbl'; readonly xml: string }[] {
  const children: { kind: 'p' | 'tbl'; xml: string }[] = []
  const pattern = /<w:(tbl|p)\b[^>]*?(\/)?>/g
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    const kind = match[1] as 'p' | 'tbl'
    if (match[2] === '/') continue
    const end = closingAt(xml, `w:${kind}`, pattern.lastIndex)
    children.push({ kind, xml: xml.slice(match.index, end) })
    pattern.lastIndex = end
  }
  return children
}

/** A Word paragraph's words: its runs' text, tabs and breaks; deleted text and field codes left out. */
function wordParagraphText(paragraph: string): string {
  const runs = paragraph.replace(/<w:pPr\b[\s\S]*?<\/w:pPr>/g, '')
  let text = ''
  for (const match of runs.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:t\b[^>]*\/>|<w:(tab|br|cr)\b[^>]*\/>/g)) {
    if (match[2] === 'tab') text += '\t'
    else if (match[2] !== undefined) text += '\n'
    else text += decodeXml(match[1] ?? '')
  }
  return text.trim()
}

function wordTable(table: string): string[][] {
  const rows: string[][] = []
  for (const row of table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) =>
      documentText(wordChildren(cell[0]).filter((child) => child.kind === 'p').map((child) => wordParagraphText(child.xml)).filter(Boolean).join(' '))
    )
    rows.push(cells)
  }
  return rows
}

/** A table, bounded; a cut is said in the paragraph after it. */
function tableBlocks(rows: readonly string[][]): DocumentBlock[] {
  if (rows.length === 0) return []
  const widest = Math.max(...rows.map((row) => row.length))
  const kept = rows.slice(0, MAX_DOCUMENT_TABLE_ROWS).map((row) => row.slice(0, MAX_DOCUMENT_TABLE_COLUMNS))
  const blocks: DocumentBlock[] = [{ kind: 'table', rows: kept }]
  if (rows.length > MAX_DOCUMENT_TABLE_ROWS || widest > MAX_DOCUMENT_TABLE_COLUMNS) {
    blocks.push({
      kind: 'paragraph',
      text: `(This table has ${String(rows.length)} rows and ${String(widest)} columns; the first ${String(Math.min(rows.length, MAX_DOCUMENT_TABLE_ROWS))} rows and ${String(Math.min(widest, MAX_DOCUMENT_TABLE_COLUMNS))} columns are shown.)`
    })
  }
  return blocks
}

function bounded(kind: OfficeDocument['kind'], blocks: readonly DocumentBlock[]): OfficeDocument {
  return { kind, blocks: blocks.slice(0, MAX_DOCUMENT_BLOCKS), more: Math.max(0, blocks.length - MAX_DOCUMENT_BLOCKS) }
}

/** A Word document's headings, paragraphs, list items and tables. Throws `WorkbookUnreadable` with a sentence. */
export function readDocx(bytes: Buffer): OfficeDocument {
  const entries = zipDirectory(bytes, WORD)
  const xml = partText(bytes, entries, 'word/document.xml', WORD)
  if (xml === undefined) throw new WorkbookUnreadable(`That file is not a ${WORD} Locust can read.`)
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? ''
  const blocks: DocumentBlock[] = []
  for (const child of wordChildren(body)) {
    if (blocks.length > MAX_DOCUMENT_BLOCKS) break
    if (child.kind === 'tbl') {
      blocks.push(...tableBlocks(wordTable(child.xml)))
      continue
    }
    const text = wordParagraphText(child.xml)
    if (text.length === 0) continue
    const properties = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(child.xml)?.[0] ?? ''
    const style = attribute(/<w:pStyle\b([^>]*?)\/?>/.exec(properties)?.[1] ?? '', 'val') ?? ''
    const outline = attribute(/<w:outlineLvl\b([^>]*?)\/?>/.exec(properties)?.[1] ?? '', 'val')
    const headingLevel = /^title$/i.test(style) ? 1 : /^heading(\d)$/i.exec(style)?.[1] ?? (outline === undefined ? undefined : String(Number(outline) + 1))
    if (headingLevel !== undefined && Number.isFinite(Number(headingLevel))) {
      blocks.push({ kind: 'heading', level: Math.min(3, Math.max(1, Number(headingLevel))) as 1 | 2 | 3, text: documentText(text) })
    } else if (/<w:numPr\b/.test(properties) || /^List(Bullet|Number|Paragraph|Continue)\d*$/i.test(style)) {
      // A list item by its own numbering, or by its style: python-docx's
      // "List Bullet 2" carries its bullet in the style, not the paragraph.
      const level = attribute(/<w:ilvl\b([^>]*?)\/?>/.exec(properties)?.[1] ?? '', 'val') ?? String(Math.max(0, Number(/(\d)$/.exec(style)?.[1] ?? '1') - 1))
      const depth = Number(level)
      blocks.push({ kind: 'item', depth: Number.isFinite(depth) ? Math.min(4, Math.max(0, depth)) : 0, text: documentText(text) })
    } else {
      blocks.push({ kind: 'paragraph', text: documentText(text) })
    }
  }
  return bounded('word', blocks)
}

/** A PowerPoint paragraph's words: runs and line breaks. */
function slideParagraphText(paragraph: string): string {
  let text = ''
  for (const match of paragraph.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g)) {
    text += match[1] === undefined ? ' ' : decodeXml(match[1])
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** A deck's slides, in the deck's order: each one's title, then its text and tables. */
export function readPptx(bytes: Buffer): OfficeDocument {
  const entries = zipDirectory(bytes, SLIDES)
  const presentation = partText(bytes, entries, 'ppt/presentation.xml', SLIDES)
  if (presentation === undefined) throw new WorkbookUnreadable(`That file is not a ${SLIDES} Locust can read.`)
  const rels = partText(bytes, entries, 'ppt/_rels/presentation.xml.rels', SLIDES) ?? ''
  const targets = new Map<string, string>()
  for (const match of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const id = attribute(match[1] ?? '', 'Id')
    const target = attribute(match[1] ?? '', 'Target')
    if (id !== undefined && target !== undefined) targets.set(id, target.startsWith('/') ? target.slice(1) : `ppt/${target}`)
  }
  const order = [...presentation.matchAll(/<p:sldId\b([^>]*?)\/?>/g)].map((match) => /\br:id="([^"]*)"/.exec(match[1] ?? '')?.[1])
  const blocks: DocumentBlock[] = []
  for (const [index, id] of order.entries()) {
    if (blocks.length > MAX_DOCUMENT_BLOCKS) break
    const target = id === undefined ? undefined : targets.get(id)
    const xml = target === undefined ? undefined : partText(bytes, entries, target, SLIDES)
    let title: string | undefined
    const inside: DocumentBlock[] = []
    for (const shape of (xml ?? '').matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
      const part = shape[0]
      if (part.startsWith('<p:graphicFrame')) {
        const rows = [...part.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((row) =>
          [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) =>
            documentText([...cell[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((paragraph) => slideParagraphText(paragraph[0])).filter(Boolean).join(' '))
          )
        )
        inside.push(...tableBlocks(rows))
        continue
      }
      const placeholder = /<p:ph\b([^>]*?)\/?>/.exec(part)
      const type = placeholder === null ? undefined : attribute(placeholder[1] ?? '', 'type') ?? 'body'
      // The slide number, date and footer say nothing a reader needs.
      if (type === 'sldNum' || type === 'dt' || type === 'ftr') continue
      const paragraphs = [...part.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((paragraph) => ({
        text: slideParagraphText(paragraph[0]),
        depth: Number(attribute(/<a:pPr\b([^>]*?)\/?>/.exec(paragraph[0])?.[1] ?? '', 'lvl') ?? '0')
      })).filter((paragraph) => paragraph.text.length > 0)
      if (type === 'title' || type === 'ctrTitle') {
        if (title === undefined && paragraphs.length > 0) title = documentText(paragraphs.map((paragraph) => paragraph.text).join(' '))
        continue
      }
      for (const paragraph of paragraphs) {
        inside.push(type === 'body' || type === 'obj'
          ? { kind: 'item', depth: Number.isFinite(paragraph.depth) ? Math.min(4, Math.max(0, paragraph.depth)) : 0, text: documentText(paragraph.text) }
          : { kind: 'paragraph', text: documentText(paragraph.text) })
      }
    }
    blocks.push({ kind: 'slide', number: index + 1, ...(title === undefined ? {} : { title }) }, ...inside)
  }
  return bounded('slides', blocks)
}
