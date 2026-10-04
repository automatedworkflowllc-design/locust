import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * BEHIND OTHER WINDOWS, NOTHING MOVES (0.611).
 *
 * windowPresence.ts marks the root `data-away` while Locust is behind other
 * windows (its own test, a-face-rests-behind-other-windows.test.ts); this is
 * the other half: the stylesheet holds every animation by that mark,
 * pseudo-elements too, above whatever rule started it. A streamed answer
 * measured 13 % of a 12-core machine behind other windows on 0.610, 3 % with
 * this and the faces' rest (probe-faces-rest-behind.mjs).
 */
const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const shell = readFileSync(`${SRC}shell.css`, 'utf8')
const presence = readFileSync(`${SRC}windowPresence.ts`, 'utf8')
const entry = readFileSync(`${SRC}main.tsx`, 'utf8')

describe('behind other windows', () => {
  it('the stylesheet holds every animation, pseudo-elements too, while the root is marked away', () => {
    const rule = /:root\[data-away\] \*,\s*:root\[data-away\] \*::before,\s*:root\[data-away\] \*::after \{\s*animation-play-state: paused !important;\s*\}/
    expect(rule.test(shell)).toBe(true)
  })

  it('the mark the stylesheet reads is the one the window sets', () => {
    expect(presence).toMatch(/AWAY_ATTRIBUTE = 'data-away'/)
    expect(presence).toMatch(/toggleAttribute\(AWAY_ATTRIBUTE/)
  })

  it('is watched from the start, so it holds with no face on screen', () => {
    expect(entry).toMatch(/^watchWindowPresence\(\)$/m)
  })
})
