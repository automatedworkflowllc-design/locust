import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A SCROLLED HOME FADES ITS TOP (0.403, fresh-eyes check: Home).
 *
 * On a small window Home is taller than its pane and keeps to its end, so the
 * cover scrolls away above -- and the pane's edge cut through it: the sign's
 * box sliced, or one thin line of it left at the top, reading as a glitch.
 * drive-signed-out checks the fade is on exactly when Home is scrolled.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const shell = read('../renderer/src/shell.css')
const home = read('../renderer/src/components/FirstLaunch.tsx')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}

describe('a scrolled Home', () => {
  it('fades its top edge, in both engines’ spelling', () => {
    const faded = rule('.lc-empty.is-scrolled')
    expect(faded).toContain('mask-image: linear-gradient(to bottom, transparent, #000 56px)')
    expect(faded).toContain('-webkit-mask-image: linear-gradient(to bottom, transparent, #000 56px)')
  })

  it('is marked from its own scroll position, on a scroll and on following its end', () => {
    expect(home.match(/setScrolled\(el\.scrollTop > 0\)/g)).toHaveLength(2)
    // 0.583 adds `is-tight` beside it (a short Home tightens its spacing).
    expect(home).toContain("className={`lc-empty${scrolled ? ' is-scrolled' : ''}${tight ? ' is-tight' : ''}`}")
  })

  it('is not faded at rest: the plain pane has no mask', () => {
    expect(rule('.lc-empty')).not.toContain('mask-image')
  })
})
