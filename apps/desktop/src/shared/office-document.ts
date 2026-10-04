/**
 * A WORD OR POWERPOINT FILE, READ -- never run (0.517).
 *
 * For someone who is not a programmer the .docx or .pptx a teammate made is
 * the deliverable, and pressing it said "Locust does not open that kind of
 * file here" (product ideas, round four). It shows in the viewer now as what
 * it says: headings, paragraphs, list items, tables, and for a deck each
 * slide's title and text. Not its layout, fonts or pictures -- a reading
 * view, the way a spreadsheet shows its cells (sheet.ts).
 *
 * The host takes the words out of the file's XML (main/office-text.ts) and
 * the renderer draws them as escaped text: no Markdown, no HTML, nothing in
 * the file runs. Macro-enabled files (.docm, .pptm) are not read.
 */

export const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set(['docx', 'pptx'])
/** A deck with pictures runs large; past this it is refused, never half read. */
export const MAX_OFFICE_FILE_BYTES = 40 * 1024 * 1024

/** At most this many blocks are drawn; the rest is said, never silently cut. */
export const MAX_DOCUMENT_BLOCKS = 4_000
/** A table keeps at most this many rows and columns. */
export const MAX_DOCUMENT_TABLE_ROWS = 200
export const MAX_DOCUMENT_TABLE_COLUMNS = 20
/** A block's text past this is cut, and says so. */
export const MAX_DOCUMENT_TEXT = 4_000

export type DocumentBlock =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'item'; readonly text: string; readonly depth: number }
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }
  /** A slide begins: its number, and its title when it has one. */
  | { readonly kind: 'slide'; readonly number: number; readonly title?: string }

export interface OfficeDocument {
  readonly kind: 'word' | 'slides'
  readonly blocks: readonly DocumentBlock[]
  /** Blocks past `MAX_DOCUMENT_BLOCKS`, not drawn. */
  readonly more: number
}

/** A block's text, bounded: long text keeps its start and says it was cut. */
export function documentText(text: string): string {
  const flat = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  return flat.length <= MAX_DOCUMENT_TEXT ? flat : `${flat.slice(0, MAX_DOCUMENT_TEXT)}… (cut here)`
}
