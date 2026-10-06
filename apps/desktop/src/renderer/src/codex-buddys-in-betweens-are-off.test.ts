import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * CODEX BUDDY'S IN-BETWEENS ARE OFF (2026-10-05). Made from his maker's few
 * drawings they still read as a slideshow beside the bots ("its not good
 * enough"), so until his own rig replaces them none are made and none are
 * read: his drawings melt into each other, with the settle and the breath.
 */

const scheduled = vi.hoisted(() => ({ slices: 0, steps: 0, reads: 0, keeps: 0 }))

vi.mock('./petTweens.js', async (original) => {
  const real = await original<typeof import('./petTweens.js')>()
  return {
    ...real,
    runInSlices: (...args: Parameters<typeof real.runInSlices>) => {
      scheduled.slices += 1
      return real.runInSlices(...args)
    },
    tweenSteps: (...args: Parameters<typeof real.tweenSteps>) => {
      scheduled.steps += 1
      return real.tweenSteps(...args)
    }
  }
})
vi.mock('./petTweenStore.js', async (original) => {
  const real = await original<typeof import('./petTweenStore.js')>()
  return {
    ...real,
    keptTweens: async (key: string) => {
      scheduled.reads += 1
      return real.keptTweens(key)
    },
    keepTweens: async (key: string, images: readonly Blob[]) => {
      scheduled.keeps += 1
      return real.keepTweens(key, images)
    }
  }
})

const { BUDDY_IN_BETWEENS, tweensFor } = await import('./components/PetSprite.js')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Codex Buddy between two drawings', () => {
  it('makes no in-betweens and reads none: nothing is scheduled, storage is never touched', () => {
    expect(BUDDY_IN_BETWEENS).toBe(false)
    // A window that would hand out a canvas, so nothing fails for want of one: only the switch stops it.
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => undefined, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) }),
      visibilityState: 'visible'
    })
    const atlas = { image: {}, rows: 9, frameWidth: 1, frameHeight: 1, body: { left: 0, top: 0, right: 1, bottom: 1 }, dark: false } as never
    for (let n = 0; n < 5; n += 1) {
      expect(tweensFor(atlas, { row: 8, column: n, rect: undefined }, { row: 8, column: n + 1, rect: undefined })).toBeUndefined()
    }
    expect(scheduled).toEqual({ slices: 0, steps: 0, reads: 0, keeps: 0 })
  })
})
