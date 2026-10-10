/*! Locust's PDF reader bundles PDF.js (https://mozilla.github.io/pdf.js/), Copyright Mozilla Foundation, under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0 */
import { getDocument } from 'pdfjs-dist'
import * as pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs'

import { pageText } from './pdfText.js'
import type { TextRun } from './pdfText.js'

/**
 * THE PAGE THAT READS A PDF (0.713), loaded in a view no one sees.
 *
 * A tester attached his homework to a Codex conversation and Codex could not
 * open it: its PDF skill wants Python packages he does not have, the sandbox
 * stops pip from fetching them, and eight commands later (four failed) it
 * decoded the file's streams by hand -- 1m 39s, against 33 s in Codex's own
 * app, which ships those packages. Every runtime can read a text file and
 * nearly every one can look at a picture, so Locust does the opening: this
 * page turns the PDF into each page's text and a picture of each page, and
 * the host writes them beside the attachment (main/pdf-reading.ts).
 *
 * pdf.js (Apache-2.0) draws with the page's own canvas, so nothing native is
 * installed. Its worker runs on this page's thread -- the view is a process
 * of its own, so there is nothing here to keep responsive, and a module
 * worker from a file:// page is refused in a packaged build. No network:
 * the bytes arrive as an argument, and a font the file does not embed is
 * drawn in a system face.
 */
;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker

interface Limits {
  /** How many pages to draw; the text is every page's. */
  readonly maxPictures: number
  /** The drawn page's longer side, in pixels. */
  readonly longSide: number
}

interface Reading {
  readonly pages: number
  /** One string per page. */
  readonly text: readonly string[]
  /** PNGs, base64, for the first `maxPictures` pages. */
  readonly pictures: readonly string[]
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function readPdf(base64: string, limits: Limits): Promise<Reading> {
  const task = getDocument({ data: base64Bytes(base64), useSystemFonts: true })
  const document = await task.promise
  try {
    const text: string[] = []
    const pictures: string[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      const runs: TextRun[] = content.items.flatMap((item) => ('str' in item ? [{ str: item.str, transform: item.transform as number[], width: item.width, height: item.height }] : []))
      text.push(pageText(runs))
      if (number <= limits.maxPictures) {
        const natural = page.getViewport({ scale: 1 })
        const scale = Math.min(3, limits.longSide / Math.max(natural.width, natural.height))
        const viewport = page.getViewport({ scale })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (context === null) throw new Error('This view cannot draw a page.')
        await page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' }).promise
        pictures.push(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
        canvas.width = 0
        canvas.height = 0
      }
      page.cleanup()
    }
    return { pages: document.numPages, text, pictures }
  } finally {
    await task.destroy()
  }
}

;(window as unknown as { locustReadPdf: typeof readPdf }).locustReadPdf = readPdf
