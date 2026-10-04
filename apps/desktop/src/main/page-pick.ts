import { PAGE_SCHEME } from './page-preview.js'
import { readPagePick, VIEWER_FRAME_NAME } from '../shared/page-pick.js'
import type { PagePick } from '../shared/page-pick.js'

/**
 * THE PICKER, run inside the page's own frame (0.484). It outlines what the
 * pointer is over, swallows the click so the page does not act on it, and
 * answers with the part that was clicked -- or nothing, on Escape or when the
 * person presses the button again. The outline is gone, and two frames drawn,
 * before it answers, so the picture taken next is of the page alone.
 *
 * Nothing is written into the page's files: this runs in its frame once, and
 * leaves when it answers.
 */
export const PICKER_SCRIPT = `(() => new Promise((resolve) => {
  const hook = '__locustPickCancel'
  if (typeof window[hook] === 'function') window[hook]()
  const root = document.documentElement
  const box = document.createElement('div')
  box.setAttribute('data-locust-pick', '')
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #8fb3ff;outline-offset:-1px;background:rgba(143,179,255,0.14);border-radius:2px;left:0;top:0;width:0;height:0'
  root.appendChild(box)
  const cursor = root.style.cursor
  root.style.cursor = 'crosshair'
  let current = null
  const under = (event) => {
    const found = document.elementFromPoint(event.clientX, event.clientY)
    return found === box ? null : found
  }
  const move = (event) => {
    const found = under(event)
    if (!found) return
    current = found
    const r = found.getBoundingClientRect()
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
  }
  const swallow = (event) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }
  const pathOf = (element) => {
    const parts = []
    let node = element
    while (node && node.nodeType === 1 && node !== root && parts.length < 5) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(part + '#' + node.id)
        break
      }
      const classes = Array.from(node.classList).slice(0, 2)
      if (classes.length > 0) part += '.' + classes.join('.')
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const events = [['mousemove', move], ['mousedown', swallow], ['mouseup', swallow], ['pointerdown', swallow], ['pointerup', swallow], ['click', null], ['keydown', null]]
  let done = false
  const finish = (value) => {
    if (done) return
    done = true
    for (const [name, handler] of events) removeEventListener(name, handler, true)
    box.remove()
    root.style.cursor = cursor
    delete window[hook]
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)))
  }
  const click = (event) => {
    swallow(event)
    const found = under(event) || current
    if (!found) return finish(null)
    const r = found.getBoundingClientRect()
    const html = found.outerHTML
    finish({ selector: pathOf(found), html: html.slice(0, 4000), htmlLength: html.length, rect: { x: r.left, y: r.top, width: r.width, height: r.height } })
  }
  const key = (event) => {
    if (event.key !== 'Escape') return
    swallow(event)
    finish(null)
  }
  events[5][1] = click
  events[6][1] = key
  window[hook] = () => finish(null)
  for (const [name, handler] of events) addEventListener(name, handler, true)
}))()`

export const CANCEL_SCRIPT = `(() => { if (typeof window.__locustPickCancel === 'function') window.__locustPickCancel() })()`

/** How long a pick may wait on the person before it is let go. */
export const PICK_WAIT_MS = 5 * 60_000

interface PickFrame {
  readonly url: string
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

/**
 * The viewer's frame showing `pageUrl`'s page, among a window's frames. The
 * page also runs on its turn's card at the same address, so the viewer's is
 * the one NAMED for it; only that one is pointed at.
 */
export function pageFrameOf<TFrame extends { readonly url: string; readonly name: string }>(frames: readonly TFrame[], pageUrl: string): TFrame | undefined {
  let host: string
  try {
    const url = new URL(pageUrl)
    if (url.protocol !== `${PAGE_SCHEME}:`) return undefined
    host = url.host
  } catch {
    return undefined
  }
  return frames.find((frame) => frame.name === VIEWER_FRAME_NAME && frame.url.startsWith(`${PAGE_SCHEME}://${host}/`))
}

/** Runs the picker in the frame and reads its answer; nothing on Escape, a cancel, or no answer in time. */
export async function pickInFrame(frame: PickFrame, wait: number = PICK_WAIT_MS): Promise<PagePick | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      void frame.executeJavaScript(CANCEL_SCRIPT).catch(() => undefined)
      resolve(undefined)
    }, wait)
  })
  try {
    const raw = await Promise.race([frame.executeJavaScript(PICKER_SCRIPT, true).catch(() => undefined), late])
    return readPagePick(raw)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Where to photograph the part in the window: the frame's box on screen, the
 * part's box inside it, cut to what the frame shows, in the window's own
 * pixels at its zoom. Undefined when nothing of it is in view.
 */
export function captureRectOf(
  frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  part: PagePick['rect'],
  zoom: number
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
  const left = Math.max(0, part.x)
  const top = Math.max(0, part.y)
  const right = Math.min(frame.width, part.x + part.width)
  const bottom = Math.min(frame.height, part.y + part.height)
  if (right - left < 1 || bottom - top < 1) return undefined
  return {
    x: Math.round((frame.x + left) * zoom),
    y: Math.round((frame.y + top) * zoom),
    width: Math.max(1, Math.round((right - left) * zoom)),
    height: Math.max(1, Math.round((bottom - top) * zoom))
  }
}
