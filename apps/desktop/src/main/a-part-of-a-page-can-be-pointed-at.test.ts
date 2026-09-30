import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

import { captureRectOf, CANCEL_SCRIPT, pageFrameOf, pickInFrame, PICKER_SCRIPT } from './page-pick.js'
import { MAX_PICKED_HTML, quoteOfPagePick, readPagePick, VIEWER_FRAME_NAME } from '../shared/page-pick.js'

/**
 * POINT AT A PART OF A PAGE (0.484). A page a teammate made runs in the file
 * viewer; a click on part of it puts that part -- where it is, its code, a
 * picture of it -- into the chat box. drive-point-at-a-page drives it on the
 * packaged app; here, the parts that do not need a window.
 */
describe('the picker', () => {
  it('is a script that parses, and so is its cancel', () => {
    expect(() => new Script(PICKER_SCRIPT)).not.toThrow()
    expect(() => new Script(CANCEL_SCRIPT)).not.toThrow()
  })

  it("finds the viewer's frame showing the page, and no other", () => {
    // The same page runs on its turn's card too, at the same address: only the viewer's is pointed at.
    const card = { url: 'locust-page://bbb/site/index.html', name: '' }
    const viewer = { url: 'locust-page://bbb/site/index.html', name: VIEWER_FRAME_NAME }
    const frames = [{ url: 'locust-page://aaa/index.html', name: VIEWER_FRAME_NAME }, card, viewer, { url: 'https://example.com/', name: VIEWER_FRAME_NAME }]
    expect(pageFrameOf(frames, 'locust-page://bbb/site/index.html')).toBe(viewer)
    expect(pageFrameOf([card], 'locust-page://bbb/site/index.html')).toBeUndefined()
    expect(pageFrameOf(frames, 'locust-page://ccc/index.html')).toBeUndefined()
    expect(pageFrameOf(frames, 'https://example.com/')).toBeUndefined()
    expect(pageFrameOf(frames, 'not an address')).toBeUndefined()
  })

  it('reads a pick, and lets go of one that never comes', async () => {
    const answer = { selector: 'main > h1', html: '<h1>Hi</h1>', htmlLength: 11, rect: { x: 1, y: 2, width: 30, height: 10 } }
    const said: string[] = []
    const frame = (reply: Promise<unknown>) => ({ url: 'locust-page://aaa/x.html', executeJavaScript: (code: string) => { said.push(code); return code === CANCEL_SCRIPT ? Promise.resolve(undefined) : reply } })
    expect(await pickInFrame(frame(Promise.resolve(answer)))).toEqual(answer)
    expect(await pickInFrame(frame(Promise.resolve(null)))).toBeUndefined()
    expect(await pickInFrame(frame(new Promise(() => undefined)), 20)).toBeUndefined()
    expect(said).toContain(CANCEL_SCRIPT)
  })
})

describe('what the page hands back is the page’s word', () => {
  it('is kept to its shape and its bounds', () => {
    expect(readPagePick(null)).toBeUndefined()
    expect(readPagePick({ selector: 'h1', html: '<h1>', htmlLength: 4 })).toBeUndefined()
    expect(readPagePick({ selector: 'h1', html: '<h1>', htmlLength: 4, rect: { x: Number.NaN, y: 0, width: 1, height: 1 } })).toBeUndefined()
    const huge = readPagePick({ selector: 's'.repeat(900), html: 'h'.repeat(9_000), htmlLength: 3, rect: { x: 0, y: 0, width: -5, height: 4 } })
    expect(huge?.selector.length).toBe(300)
    expect(huge?.html.length).toBe(4_000)
    expect(huge?.htmlLength).toBe(9_000)
    expect(huge?.rect.width).toBe(0)
  })
})

describe('the quote it becomes', () => {
  it('names the file and the part, and quotes its code', () => {
    const quote = quoteOfPagePick('index.html', { selector: 'main > section.hero > h1', html: '<h1 class="title">\n  Fresh bread\n</h1>', htmlLength: 36 })
    expect(quote.split('\n')).toEqual([
      '> About this part of index.html: `main > section.hero > h1`',
      '> ```html',
      '> <h1 class="title">',
      '>   Fresh bread',
      '> </h1>',
      '> ```'
    ])
  })

  it('counts what it leaves out, and a fence in the code cannot close the quote', () => {
    const long = quoteOfPagePick('a.html', { selector: 'div', html: 'x'.repeat(MAX_PICKED_HTML + 40), htmlLength: MAX_PICKED_HTML + 540 })
    expect(long).toContain(`(540 more characters of its code not shown)`)
    const fenced = quoteOfPagePick('a.html', { selector: 'pre', html: '<pre>```js</pre>', htmlLength: 16 })
    expect(fenced).toContain('> ````html')
  })
})

describe('the picture of it', () => {
  const frame = { x: 600, y: 100, width: 400, height: 300 }
  it('is the part inside the frame, in the window’s pixels at its zoom', () => {
    expect(captureRectOf(frame, { x: 10, y: 20, width: 100, height: 50 }, 1)).toEqual({ x: 610, y: 120, width: 100, height: 50 })
    expect(captureRectOf(frame, { x: 10, y: 20, width: 100, height: 50 }, 1.25)).toEqual({ x: 763, y: 150, width: 125, height: 63 })
  })

  it('is cut to what the frame shows, and is none when nothing of it is', () => {
    expect(captureRectOf(frame, { x: -50, y: 250, width: 100, height: 200 }, 1)).toEqual({ x: 600, y: 350, width: 50, height: 50 })
    expect(captureRectOf(frame, { x: 10, y: 400, width: 100, height: 50 }, 1)).toBeUndefined()
  })
})
