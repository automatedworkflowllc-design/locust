import { describe, expect, it } from 'vitest'

import { createFrameBatcher } from './streamFrames.js'

/**
 * Deltas land once per frame, in order, and nothing terminal waits a frame.
 *
 * Colin, 2026-09-10: the text "comes out rather aggressively or glitchy". Each
 * delta was its own IPC task and so its own render. Claude Code's renderer
 * coalesces; this is that, and these are the four things it must not get
 * wrong while doing it.
 */

/** A scheduler the test drives by hand, so a "frame" is a call and not a wait. */
function manualFrames(): { readonly schedule: (cb: () => void) => () => void; readonly tick: () => void; readonly pending: () => number } {
  let queued: (() => void)[] = []
  return {
    schedule: (cb) => {
      queued.push(cb)
      return () => {
        queued = queued.filter((entry) => entry !== cb)
      }
    },
    tick: () => {
      const now = queued
      queued = []
      for (const cb of now) cb()
    },
    pending: () => queued.length
  }
}

describe('deltas landing once per frame', () => {
  it('commit a burst as ONE commit, in the order they came', () => {
    const frames = manualFrames()
    const commits: (readonly string[])[] = []
    const batcher = createFrameBatcher<string>((items) => commits.push(items), frames.schedule)
    batcher.push('a')
    batcher.push('b')
    batcher.push('c')
    expect(commits).toEqual([])
    expect(frames.pending()).toBe(1)
    frames.tick()
    expect(commits).toEqual([['a', 'b', 'c']])
  })

  it('never let a terminal update wait a frame, and keep what was ahead of it ahead', () => {
    // run.completed after three deltas: all four land now, deltas first.
    const frames = manualFrames()
    const commits: (readonly string[])[] = []
    const batcher = createFrameBatcher<string>((items) => commits.push(items), frames.schedule)
    batcher.push('d1')
    batcher.push('d2')
    batcher.push('done', true)
    expect(commits).toEqual([['d1', 'd2', 'done']])
    // And the frame that was scheduled for the deltas is cancelled, not left
    // to fire an empty commit later.
    frames.tick()
    expect(commits).toHaveLength(1)
  })

  it('schedule exactly one frame however many deltas arrive in it', () => {
    const frames = manualFrames()
    const batcher = createFrameBatcher<number>(() => undefined, frames.schedule)
    for (let index = 0; index < 50; index += 1) batcher.push(index)
    expect(frames.pending()).toBe(1)
  })

  it('lose nothing on dispose', () => {
    const frames = manualFrames()
    const commits: (readonly string[])[] = []
    const batcher = createFrameBatcher<string>((items) => commits.push(items), frames.schedule)
    batcher.push('last words')
    batcher.dispose()
    expect(commits).toEqual([['last words']])
    frames.tick()
    expect(commits).toHaveLength(1)
  })

  it('flush is idempotent and an empty flush commits nothing', () => {
    const frames = manualFrames()
    const commits: (readonly string[])[] = []
    const batcher = createFrameBatcher<string>((items) => commits.push(items), frames.schedule)
    batcher.flush()
    batcher.flush()
    expect(commits).toEqual([])
  })
})
