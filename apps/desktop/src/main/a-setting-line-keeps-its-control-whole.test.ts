import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A SETTING'S CONTROL IS NEVER CUT (0.635).
 *
 * Found while filming the face legend (2026-10-05): at an 860x720 window the
 * Terminal faces line's On/Off pair read "On" and half an "Off", and at 1215
 * it had lost 7px. `.lc-segmented` clips what overflows it, so a flex item of
 * the line with no `flex: none` had no minimum width and shrank before the
 * words beside it wrapped. drive-settings-controls-whole.mjs measures every
 * Settings page at both sizes; this pins the rule it found missing.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')

const rule = (selector: string): string => {
  const at = shell.indexOf(`\n${selector} {`)
  expect(at, selector).toBeGreaterThanOrEqual(0)
  return shell.slice(at, shell.indexOf('\n}', at) + 2)
}

describe("a setting line keeps its control whole", () => {
  it('never shrinks anything beside the words', () => {
    expect(rule('.lc-settingline > :not(.lc-settingline__text)')).toMatch(/^\s*flex:\s*none;/m)
  })

  it('lets the words shrink and wrap instead', () => {
    const text = rule('.lc-settingline__text')
    expect(text).toMatch(/min-width:\s*0/)
    expect(text).not.toMatch(/^\s*flex:\s*none;/m)
  })

  it('is needed because the On/Off pair clips what overflows it', () => {
    expect(rule('.lc-segmented')).toMatch(/overflow:\s*hidden/)
  })
})
