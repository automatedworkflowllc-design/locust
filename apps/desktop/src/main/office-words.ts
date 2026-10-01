import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { DocumentBlock, OfficeDocument } from '../shared/office-document.js'
import { MAX_OFFICE_FILE_BYTES } from '../shared/office-document.js'
import { keepOutOfGit } from './attachments-for-run.js'
import { readDocx, readPptx } from './office-text.js'

/**
 * A WORD OR POWERPOINT FILE A TEAMMATE CAN READ, IN ANY MODE (0.530).
 *
 * Sol's 0.528 pass, as an office user: a teammate in Ask was asked to
 * summarise a .docx and a .pptx, and declined -- its read tool rejected them
 * as binary, and the shell it would have unzipped them with is exactly what
 * Ask withholds. The preview read both perfectly, because Locust takes the
 * words out of the XML itself (office-text.ts). So the teammate gets those
 * same words: a text copy of each file under `.locust/office-words/`, the one
 * folder Locust writes into a project (kept out of git, like attachments),
 * refreshed when the document changes, and named in the brief.
 *
 * A copy, and said to be one: editing it changes nothing in the document.
 * Bounded: the folder and one level down, at most `MAX_FILES` files, each
 * under the preview's own size limit. Nothing in a file runs.
 */
export const OFFICE_WORDS_DIR = '.locust/office-words'
export const MAX_FILES = 12
const SKIPPED = new Set(['.git', '.locust', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target'])

/** The document's words as plain Markdown-ish text: headings, items, tables, slides. */
export function documentWords(name: string, document: OfficeDocument): string {
  const lines: string[] = [`Words of ${name}, read by Locust. A copy: editing it changes nothing in the document.`, '']
  const write = (block: DocumentBlock): void => {
    if (block.kind === 'heading') lines.push(`${'#'.repeat(block.level)} ${block.text}`, '')
    else if (block.kind === 'paragraph') lines.push(block.text, '')
    else if (block.kind === 'item') lines.push(`${'  '.repeat(block.depth)}- ${block.text}`)
    else if (block.kind === 'slide') lines.push('', `## Slide ${String(block.number)}${block.title === undefined ? '' : `: ${block.title}`}`, '')
    else {
      const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
      block.rows.forEach((row, at) => {
        lines.push(`| ${row.map(cell).join(' | ')} |`)
        if (at === 0) lines.push(`| ${row.map(() => '---').join(' | ')} |`)
      })
      lines.push('')
    }
  }
  for (const block of document.blocks) write(block)
  if (document.more > 0) lines.push(`(${String(document.more)} more parts of the document were not read.)`)
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

const officeKind = (name: string): 'docx' | 'pptx' | undefined => {
  // `~$name.docx` is Word's own lock file while a document is open.
  if (name.startsWith('~$')) return undefined
  const lower = name.toLowerCase()
  return lower.endsWith('.docx') ? 'docx' : lower.endsWith('.pptx') ? 'pptx' : undefined
}

/** The Word and PowerPoint files in a folder and one level down, project-relative with `/`. */
async function officeFiles(folder: string): Promise<string[]> {
  const found: string[] = []
  const look = async (relative: string, depth: number): Promise<void> => {
    const entries = await readdir(join(folder, relative), { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FILES) return
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isFile() && officeKind(entry.name) !== undefined) found.push(path)
      else if (entry.isDirectory() && depth === 0 && !SKIPPED.has(entry.name) && !entry.name.startsWith('.')) await look(path, 1)
    }
  }
  await look('', 0)
  return found
}

/**
 * Writes or refreshes the copies, and returns the brief's section naming them,
 * or undefined when the folder holds no Word or PowerPoint file. Never throws:
 * a copy that will not write is left out, and the run goes ahead without it.
 */
export async function officeWordsSection(folder: string): Promise<string | undefined> {
  const files = await officeFiles(folder)
  if (files.length === 0) return undefined
  const kept: string[] = []
  for (const path of files) {
    try {
      const source = await stat(join(folder, path))
      if (source.size > MAX_OFFICE_FILE_BYTES) continue
      const copy = `${OFFICE_WORDS_DIR}/${path}.md`
      const held = await stat(join(folder, copy)).catch(() => undefined)
      if (held === undefined || held.mtimeMs < source.mtimeMs) {
        const bytes = await readFile(join(folder, path))
        const document = officeKind(path) === 'docx' ? readDocx(bytes) : readPptx(bytes)
        await mkdir(dirname(join(folder, copy)), { recursive: true })
        await writeFile(join(folder, copy), documentWords(path, document), 'utf8')
      }
      kept.push(`- ${path}: ${copy}`)
    } catch {
      // Not readable as a document (damaged, or not really one): left out.
    }
  }
  if (kept.length === 0) return undefined
  await keepOutOfGit(folder)
  return [
    'Word and PowerPoint files here are not plain text, so Locust keeps a text copy of the words in each. Read the copy to know what a document says; it is refreshed when the document changes, and editing a copy changes nothing in the document:',
    ...kept
  ].join('\n')
}
