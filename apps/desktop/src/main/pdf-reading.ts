import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ATTACHMENT_DIR } from '../shared/attachments.js'
import type { ReadablePdf } from '../shared/attachments.js'

/**
 * AN ATTACHED PDF, OPENED FOR EVERY AGENT (0.713).
 *
 * A tester attached his homework to a Codex conversation on 0.712. Codex's
 * PDF skill wants Python packages, his machine had none, and the sandbox
 * stopped pip from fetching them: eight commands, four failed, and the file
 * decoded by hand -- 1m 39s for what Codex's own app, which ships the
 * packages, answered in 33 s. Claude Code opens a PDF itself; the others
 * each do it their own way or not at all.
 *
 * So Locust opens it, the same way for all of them: each page's text into
 * one file, and a picture of each page, written into Locust's own folder
 * beside the attachments (never into the person's files) and named in the
 * message (`readablePdfNote`). Every runtime can read a text file; the ones
 * that look at pictures get the page as printed, which is what an equation
 * or a table needs. The reading itself happens in a view no one sees
 * (pdf-window.ts), and is kept: the same PDF is never read twice.
 */

/** What the view made of one PDF. */
export interface PdfReading {
  readonly pages: number
  /** One string per page. */
  readonly text: readonly string[]
  /** PNG bytes for the first pages. */
  readonly pictures: readonly Uint8Array[]
}

export type ReadPdf = (bytes: Uint8Array) => Promise<PdfReading>

/** Larger than this is left to the runtime: a 64 MB file is a scan or a book. */
export const MAX_PDF_BYTES = 64 * 1024 * 1024

export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** `page-01.png`: two digits sort right for the thirty pages that are drawn. */
export function pictureName(page: number): string {
  return `page-${String(page).padStart(2, '0')}.png`
}

/** The text file's contents: a line saying what it is, then each page under its number. */
export function readingText(name: string, reading: PdfReading): string {
  const pages = reading.text.map((text, index) => `--- Page ${String(index + 1)} ---\n${text.trim()}`)
  const header =
    `${name}, ${String(reading.pages)} ${reading.pages === 1 ? 'page' : 'pages'}: the text Locust read out of it. ` +
    'Equations and tables can come out of order here; the page pictures show them as printed.'
  // A byte-order mark, so Windows PowerShell's Get-Content reads it as UTF-8
  // rather than the machine's code page -- the shell Codex reaches for here.
  return `﻿${header}\n\n${pages.join('\n\n')}\n`
}

interface Kept {
  readonly digest: string
  readonly readable: Omit<ReadablePdf, 'pdf'>
}

async function readKept(path: string): Promise<Kept | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<Kept>
    if (typeof parsed.digest !== 'string' || typeof parsed.readable !== 'object' || parsed.readable === null) return undefined
    const readable = parsed.readable as Partial<ReadablePdf>
    if (typeof readable.pages !== 'number' || !Array.isArray(readable.pictures)) return undefined
    if (!readable.pictures.every((picture): picture is string => typeof picture === 'string')) return undefined
    if (readable.text !== undefined && typeof readable.text !== 'string') return undefined
    return { digest: parsed.digest, readable: { pages: readable.pages, pictures: readable.pictures, ...(readable.text === undefined ? {} : { text: readable.text }) } }
  } catch {
    return undefined
  }
}

async function present(folder: string, paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      if (!(await stat(join(folder, path))).isFile()) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * Text and pictures for the PDF at `pdf` (folder-relative), written into
 * `<folder>/.locust/attachments` under `name` -- the caller keeps two PDFs of
 * one name in one message apart. Undefined for a file that is not a PDF it
 * can read; a reader that fails rejects, and the caller sends the message as
 * it was.
 */
export async function readablePdf(folder: string, pdf: string, name: string, read: ReadPdf, maxPictures = 30): Promise<ReadablePdf | undefined> {
  const source = join(folder, pdf)
  const info = await stat(source)
  if (!info.isFile() || info.size === 0 || info.size > MAX_PDF_BYTES) return undefined
  const bytes = await readFile(source)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const textPath = `${ATTACHMENT_DIR}/${name}.txt`
  const picturesFolder = `${ATTACHMENT_DIR}/${name}-pages`
  const keptPath = join(folder, picturesFolder, 'locust-reading.json')
  const kept = await readKept(keptPath)
  if (kept !== undefined && kept.digest === digest && (await present(folder, [...(kept.readable.text === undefined ? [] : [kept.readable.text]), ...kept.readable.pictures]))) {
    return { pdf, ...kept.readable }
  }
  const reading = await read(bytes)
  const hasText = reading.text.some((page) => page.trim().length > 0)
  await rm(join(folder, picturesFolder), { recursive: true, force: true })
  await mkdir(join(folder, picturesFolder), { recursive: true })
  const pictures: string[] = []
  for (const [index, picture] of reading.pictures.slice(0, maxPictures).entries()) {
    const path = `${picturesFolder}/${pictureName(index + 1)}`
    await writeFile(join(folder, path), picture)
    pictures.push(path)
  }
  if (hasText) await writeFile(join(folder, textPath), readingText(name, reading), 'utf8')
  else await rm(join(folder, textPath), { force: true })
  const readable: Omit<ReadablePdf, 'pdf'> = { pages: reading.pages, pictures, ...(hasText ? { text: textPath } : {}) }
  await writeFile(keptPath, JSON.stringify({ digest, readable } satisfies Kept, null, 2), 'utf8')
  return { pdf, ...readable }
}

/**
 * One reading per PDF at a time: the attach button starts it, so it is often
 * done before Send, and Send waits for the one already under way rather than
 * starting a second. Keyed by where the file is and what it is now.
 */
export function createPdfReadings(read: ReadPdf): {
  readonly prepare: (folder: string, pdf: string, name: string) => Promise<ReadablePdf | undefined>
} {
  const underway = new Map<string, Promise<ReadablePdf | undefined>>()
  return {
    prepare: async (folder, pdf, name) => {
      const info = await stat(join(folder, pdf))
      const key = `${join(folder, pdf)}|${name}|${String(info.size)}|${String(info.mtimeMs)}`
      const existing = underway.get(key)
      if (existing !== undefined) return await existing
      const job = readablePdf(folder, pdf, name, read)
      underway.set(key, job)
      // Kept only while it runs: once written, the files are the record.
      void job.finally(() => underway.delete(key)).catch(() => undefined)
      return await job
    }
  }
}
