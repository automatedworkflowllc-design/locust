import type { PdfPagesResponse } from '../../shared/ipc.js'

/**
 * AN ATTACHED PDF'S PAGES, AS THE WINDOW HOLDS THEM (0.714).
 *
 * The chat's card for a PDF draws its first page, and the viewer every page:
 * pictures Locust drew for the agent (main/pdf-reading.ts), asked of the host
 * once per file (main/pdf-pages.ts) and kept here, so a thread that redraws a
 * hundred times reads them once. Only an answer is kept; a refusal is asked
 * again next time, since the reading it waited on may have finished.
 */
const pages = new Map<string, Promise<PdfPagesResponse>>()
const pictures = new Map<string, Promise<string | undefined>>()

export function pdfPagesOf(path: string, folder: string | undefined): Promise<PdfPagesResponse> {
  const bridge = window.desktop
  if (bridge === undefined) return Promise.resolve({ ok: false, message: 'Not in Locust.' })
  const key = `${folder ?? ''}\u0000${path}`
  const held = pages.get(key)
  if (held !== undefined) return held
  const asked = bridge.pdfPages(path, folder).catch(() => ({ ok: false, message: 'Locust could not read that PDF.' }) as const)
  pages.set(key, asked)
  void asked.then((answer) => {
    if (!answer.ok) pages.delete(key)
  })
  return asked
}

/** One page's picture as a `data:` URL, or undefined when it could not be read. */
export function pdfPictureOf(picture: string, folder: string | undefined): Promise<string | undefined> {
  const bridge = window.desktop
  if (bridge === undefined) return Promise.resolve(undefined)
  const key = `${folder ?? ''}\u0000${picture}`
  const held = pictures.get(key)
  if (held !== undefined) return held
  const asked = bridge
    .readWorkspaceImage(picture, folder)
    .then((answer) => (answer.ok ? answer.dataUrl : undefined))
    .catch(() => undefined)
  pictures.set(key, asked)
  void asked.then((url) => {
    if (url === undefined) pictures.delete(key)
  })
  return asked
}

/** "PDF · 2 pages", "PDF": what a PDF's card says under its name. */
export function pdfMeta(pageCount: number | undefined): string {
  return pageCount === undefined ? 'PDF' : `PDF · ${String(pageCount)} ${pageCount === 1 ? 'page' : 'pages'}`
}

export function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path)
}
