import { afterEach, describe, expect, it, vi } from 'vitest'

import { anchorSoon } from './components/Bot.js'

/*
 * EVERY FACE MEASURES BEFORE ANY FACE WRITES (0.573).
 *
 * Colin, 10/03: "hitching/lagging when clicking between two working
 * sessions". Measured on a copy of his ledger (_tools/profile-real-switch.mjs):
 * one conversation draws 86 faces beside its turns, and each face read its
 * place on the page and then wrote CSS variables on its box -- so each read
 * after the face before it had written laid the whole page out again. A click
 * into that conversation froze the window 0.73-0.80 s; with the reads first
 * and the writes after, 0.60-0.62 s, and getBoundingClientRect left the top
 * of the profile.
 */

type Rect = { left: number; top: number; width: number; height: number }
const RECT: Rect = { left: 0, top: 0, width: 40, height: 40 }
const OPAQUE = new Uint8ClampedArray(4 * 4 * 4).fill(255)

function face(name: string, log: string[]) {
  const host = {
    getBoundingClientRect: (): Rect => { log.push(`read ${name}`); return RECT },
    offsetWidth: 40,
    offsetHeight: 40,
    style: { setProperty: () => void log.push(`write ${name}`) }
  }
  const canvas = {
    isConnected: true,
    width: 4,
    height: 4,
    closest: () => host,
    getBoundingClientRect: (): Rect => { log.push(`read ${name}`); return RECT }
  }
  const context = { getImageData: () => ({ data: OPAQUE }) }
  return { canvas: canvas as unknown as HTMLCanvasElement, context: context as unknown as CanvasRenderingContext2D }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('faces placing their ring and dot', () => {
  it('wait for one frame, which measures every face before any of them writes', () => {
    const log: string[] = []
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const settled: boolean[] = []
    for (const name of ['a', 'b', 'c']) {
      const { canvas, context } = face(name, log)
      anchorSoon({ canvas, context, key: `measure-first-${name}`, settle: (done) => void settled.push(done) })
    }
    // Nothing is read while the faces are being drawn...
    expect(log).toEqual([])
    // ...and the three share one frame.
    expect(frames).toHaveLength(1)
    frames[0]!(0)
    const lastRead = log.map((line) => line.startsWith('read')).lastIndexOf(true)
    const firstWrite = log.findIndex((line) => line.startsWith('write'))
    expect(firstWrite).toBeGreaterThan(lastRead)
    expect(log.filter((line) => line.startsWith('read'))).toHaveLength(6)
    expect(new Set(log.filter((line) => line.startsWith('write')))).toEqual(new Set(['write a', 'write b', 'write c']))
    expect(settled).toEqual([true, true, true])
  })

  it('a face gone before its frame is let go without a read', () => {
    const log: string[] = []
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const { canvas, context } = face('gone', log)
    Object.defineProperty(canvas, 'isConnected', { value: false })
    let settled: boolean | undefined
    anchorSoon({ canvas, context, key: 'measure-first-gone', settle: (done) => { settled = done } })
    frames[0]!(0)
    expect(log).toEqual([])
    expect(settled).toBe(true)
  })

  it('a face not laid out yet is told so, to try again', () => {
    const log: string[] = []
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const { canvas, context } = face('hidden', log)
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 0, height: 0 }) })
    let settled: boolean | undefined
    anchorSoon({ canvas, context, key: 'measure-first-hidden', settle: (done) => { settled = done } })
    frames[0]!(0)
    expect(log.some((line) => line.startsWith('write'))).toBe(false)
    expect(settled).toBe(false)
  })
})
