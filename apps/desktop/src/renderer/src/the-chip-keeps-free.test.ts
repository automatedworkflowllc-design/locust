import { describe, expect, it } from 'vitest'

import { freeTagOf } from './routeName.js'

/**
 * THE ROUTE CHIP KEEPS "FREE".
 *
 * The chip truncates a model name at 18 characters, and OpenCode's free
 * models end in the word: "OpenCode / Muse Spark 1.3 C..." on every free run
 * (Yurt's beta report, 2026-09-23, #12). The word is drawn as its own tag,
 * outside the part that is cut.
 */
describe("the chip's free tag", () => {
  it('splits a trailing Free off the name', () => {
    expect(freeTagOf('Muse Spark 1.3 Contributor Free')).toEqual({ name: 'Muse Spark 1.3 Contributor', free: true })
    expect(freeTagOf('Mimo V2.6 Flash Free')).toEqual({ name: 'Mimo V2.6 Flash', free: true })
  })

  it('leaves every other name whole', () => {
    expect(freeTagOf('Haiku 4.5')).toEqual({ name: 'Haiku 4.5', free: false })
    expect(freeTagOf('Freehand 2')).toEqual({ name: 'Freehand 2', free: false })
    expect(freeTagOf('Free')).toEqual({ name: 'Free', free: false })
  })
})
