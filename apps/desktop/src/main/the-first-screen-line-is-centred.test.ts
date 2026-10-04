import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE LINE UNDER THE MACHINE IS CENTRED UNDER IT -- the half of the first
 * screen that markup cannot show; probe-first-screen-centre measures it on
 * the built app.
 *
 * Colin, 2026-09-24, with a frame of the first screen: "text is way off
 * center". "Your coding agents, on your own accounts. OpenCode works without
 * one." began at the column's left edge under a machine centred in the
 * column: its middle was 182px left of the machine's at 1215 wide.
 */
const shell = readFileSync(fileURLToPath(new URL('../renderer/src/shell.css', import.meta.url)), 'utf8')
const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}

describe('the line under the machine', () => {
  it('is centred in the column, as the machine is, box and words both', () => {
    const intro = rule('.lc-intro')
    expect(intro).toContain('align-self: center')
    expect(intro).toContain('text-align: center')
  })

  it('under a machine that is centred in the same column', () => {
    // The cover is the column's full width and the machine is centred on it,
    // so the column's centre is the machine's.
    expect(rule('.lc-cover')).toContain('width: 100%')
    expect(rule('.lc-empty__inner')).toContain('flex-direction: column')
  })
})
