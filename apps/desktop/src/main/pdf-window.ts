import { WebContentsView } from 'electron'
import type { WebContents } from 'electron'

import type { PdfReading, ReadPdf } from './pdf-reading.js'

/**
 * THE VIEW THAT READS A PDF (0.713): Locust's own page (renderer/pdf.html),
 * loaded in a web view that belongs to no window, so nothing appears, the
 * taskbar shows nothing, and no "every window" loop in the host ever finds
 * it -- a hidden BrowserWindow would have been offered to the tray's Open
 * and to a second launch as the window to show.
 *
 * OFFSCREEN, because a view with no window never draws a frame: measured on
 * Electron 44, its `requestAnimationFrame` never fires, and pdf.js waited
 * on one inside `page.render` forever -- the first drive's PDF was never
 * opened at all. Rendered offscreen, the same view reads the practice sheet
 * in 0.2 s, as a hidden window does.
 *
 * Sandboxed, no preload, no Node: the page gets the PDF's bytes as an
 * argument and returns text and PNGs, and cannot navigate or open anything.
 * One reading at a time, and each in a fresh view that is closed after, so
 * one PDF cannot leave anything behind for the next.
 */
export interface PdfViewOptions {
  /** Loads `pdf.html` into the view: the dev server's address, or the packaged file. */
  readonly load: (contents: WebContents) => Promise<void>
  readonly maxPictures?: number
  readonly longSide?: number
  readonly timeoutMs?: number
}

interface Returned {
  readonly pages?: unknown
  readonly text?: unknown
  readonly pictures?: unknown
}

export function createViewPdfReader(options: PdfViewOptions): ReadPdf {
  const maxPictures = options.maxPictures ?? 30
  const longSide = options.longSide ?? 1600
  const timeoutMs = options.timeoutMs ?? 120_000
  let queue: Promise<unknown> = Promise.resolve()

  const readOnce = async (bytes: Uint8Array): Promise<PdfReading> => {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, webgl: false, offscreen: true }
    })
    const contents = view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const work = (async () => {
        await options.load(contents)
        const call = `window.locustReadPdf(${JSON.stringify(Buffer.from(bytes).toString('base64'))}, ${JSON.stringify({ maxPictures, longSide })})`
        return (await contents.executeJavaScript(call)) as Returned
      })()
      const returned = await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('The PDF took too long to read.')), timeoutMs)
        })
      ])
      const pages = typeof returned.pages === 'number' && Number.isInteger(returned.pages) && returned.pages >= 0 ? returned.pages : undefined
      const text = Array.isArray(returned.text) && returned.text.every((page): page is string => typeof page === 'string') ? returned.text : undefined
      const pictures = Array.isArray(returned.pictures) && returned.pictures.every((picture): picture is string => typeof picture === 'string') ? returned.pictures : undefined
      if (pages === undefined || text === undefined || pictures === undefined) throw new Error('The PDF reader returned something unreadable.')
      return { pages, text, pictures: pictures.slice(0, maxPictures).map((picture) => Buffer.from(picture, 'base64')) }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (!contents.isDestroyed()) contents.close()
    }
  }

  return (bytes) => {
    const job = queue.then(() => readOnce(bytes))
    queue = job.catch(() => undefined)
    return job
  }
}
