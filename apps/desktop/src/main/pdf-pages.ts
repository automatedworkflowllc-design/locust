import { stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'

import type { ReadablePdf } from '../shared/attachments.js'
import type { PdfPagesResponse } from '../shared/ipc.js'
import { decideReveal, insideOnDisk } from './reveal-file.js'
import { isPdfPath, MAX_PDF_BYTES } from './pdf-reading.js'

/**
 * AN ATTACHED PDF'S PAGES, FOR THE PERSON (0.714).
 *
 * Locust draws a picture of each page of an attached PDF for the agent
 * (pdf-reading.ts). The same pictures are what the chat's file card shows --
 * the first page, where a PDF was a path in a monospace chip -- and what the
 * viewer shows when it is opened, which is the in-app reader a tester
 * expected after 0.712 ("I think something is wrong with the locust pdf
 * reader"). A PDF attached before 0.713 has no pictures yet, and is read on
 * the way, by the same reader and the same cache.
 *
 * The image handler's question, asked the same way (workspace-image.ts): may
 * the window have this file's pages. A path is a request; the roots are the
 * host's, and the PDF must be inside the folder asked about, on disk too.
 */
export async function readPdfPages(
  requested: unknown,
  folder: unknown,
  roots: readonly string[],
  prepare: (folder: string, pdf: string, name: string) => Promise<ReadablePdf | undefined>
): Promise<PdfPagesResponse> {
  if (typeof requested !== 'string' || requested.length === 0) return { ok: false, message: 'No path.' }
  if (typeof folder !== 'string' || !isAbsolute(folder) || !decideReveal(folder, roots).ok) return { ok: false, message: 'No workspace.' }
  if (!isPdfPath(requested)) return { ok: false, message: 'Not a PDF.' }
  // Schemes (including data:) and network paths never become disk requests.
  if (/^(?![a-z]:[\\/])[a-z][a-z\d+.-]*:|^[\\/]{2}/i.test(requested)) return { ok: false, message: 'Not a local file.' }
  const decision = decideReveal(resolve(folder, requested), [folder])
  if (!decision.ok) return { ok: false, message: 'Outside the workspace.' }
  try {
    if (!(await insideOnDisk(folder, roots)) || !(await insideOnDisk(decision.path, [folder]))) return { ok: false, message: 'Outside the workspace.' }
    const measured = await stat(decision.path)
    if (!measured.isFile()) return { ok: false, message: 'Not a file.' }
    if (measured.size > MAX_PDF_BYTES) return { ok: false, message: 'Too large for Locust to draw.' }
    const inFolder = relative(folder, decision.path).split('\\').join('/')
    const readable = await prepare(folder, inFolder, basename(inFolder))
    if (readable === undefined) return { ok: false, message: 'Locust could not read that PDF.' }
    return { ok: true, pages: readable.pages, pictures: readable.pictures, ...(readable.text === undefined ? {} : { text: readable.text }) }
  } catch {
    return { ok: false, message: 'Locust could not read that PDF.' }
  }
}
