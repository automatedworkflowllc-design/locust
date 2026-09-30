/**
 * POINT AT A PART OF A PAGE (0.484; Orca's Design Mode, the plan's "later"
 * list). A web page a teammate made runs in the file viewer; the person clicks
 * a part of it, and that part -- where it is, its code, and a picture of it --
 * goes into the chat box as a quote, the way "Ask about this" quotes a reply
 * (0.475). Nothing is sent until the person sends it.
 *
 * What the page hands back is the page's word: its own scripts run in the
 * world the picker runs in and could change the answer. So it is read as
 * data, bounded here, and shown to the person in their own message before
 * anything goes anywhere.
 */

/**
 * The viewer's frame is NAMED this: the same page also runs on its turn's card
 * in the thread, at the same address, and the pick belongs in the viewer.
 */
export const VIEWER_FRAME_NAME = 'locust-viewer-page'

/** The most of a part's code that is quoted; the rest is counted. */
export const MAX_PICKED_HTML = 1_500

export interface PagePick {
  /** Where the part is, as `main > section.hero > h1`. */
  readonly selector: string
  /** Its code, as the page has it now, cut to what the picker returns. */
  readonly html: string
  /** How long its code was before any cut. */
  readonly htmlLength: number
  /** Where it was drawn inside the page, in the page's own pixels. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** The picker's answer, if it is one; anything else is no pick. */
export function readPagePick(raw: unknown): PagePick | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const found = raw as Record<string, unknown>
  const rect = typeof found.rect === 'object' && found.rect !== null ? (found.rect as Record<string, unknown>) : undefined
  if (typeof found.selector !== 'string' || typeof found.html !== 'string' || !finite(found.htmlLength)) return undefined
  if (rect === undefined || !finite(rect.x) || !finite(rect.y) || !finite(rect.width) || !finite(rect.height)) return undefined
  if (found.selector.length === 0 || found.html.length === 0) return undefined
  return {
    selector: found.selector.slice(0, 300),
    html: found.html.slice(0, 4_000),
    htmlLength: Math.max(found.html.length, Math.floor(found.htmlLength)),
    rect: { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) }
  }
}

/** A fence the quoted code cannot close early. */
function fenceFor(code: string): string {
  let fence = '```'
  while (code.includes(fence)) fence += '`'
  return fence
}

/** The part, as the quote that opens the person's message. */
export function quoteOfPagePick(fileName: string, pick: Pick<PagePick, 'selector' | 'html' | 'htmlLength'>): string {
  const shown = pick.html.length > MAX_PICKED_HTML ? pick.html.slice(0, MAX_PICKED_HTML) : pick.html
  const left = pick.htmlLength - shown.length
  const fence = fenceFor(shown)
  const lines = [
    `About this part of ${fileName}: \`${pick.selector.replace(/`/g, "'")}\``,
    `${fence}html`,
    ...shown.split(/\r?\n/),
    fence,
    ...(left > 0 ? [`(${String(left)} more characters of its code not shown)`] : [])
  ]
  return lines.map((line) => `> ${line}`).join('\n')
}
