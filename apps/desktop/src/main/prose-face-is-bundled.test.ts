import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The teammate's voice is a real, bundled face -- three files, one licence.
 *
 * A `@font-face` naming a file that is not there does not warn: the rule
 * silently falls through to the next family in the stack, and the reply
 * quietly goes back to wearing the app's voice. Nothing on screen would say
 * so. A missing italic is quieter still -- Chromium shears the upright, which
 * is exactly the defect the third file exists to prevent.
 *
 * And the licence has to travel with the files: SIL OFL 1.1 asks for that,
 * and it is the one obligation bundling carries.
 */

const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const FONTS = join(SRC, 'assets', 'fonts')
const FACES = ['IBMPlexSans-Regular', 'IBMPlexSans-Medium', 'IBMPlexSans-Italic'] as const

describe("the teammate's voice", () => {
  it('is three real woff2 files on disk, not a name the stack falls through', () => {
    for (const name of FACES) {
      const path = join(FONTS, `${name}.woff2`)
      expect(statSync(path).size, name).toBeGreaterThan(20_000)
      // The WOFF2 signature, so a 404 page saved as a .woff2 cannot pass.
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), name).toBe('wOF2')
    }
  })

  it('carries its licence beside it, and it is the one Geist already ships under', () => {
    const licence = readFileSync(join(FONTS, 'IBM-Plex-LICENSE.txt'), 'utf8')
    expect(licence).toContain('SIL Open Font License, Version 1.1')
    expect(licence).toContain('Reserved Font Name "Plex"')
  })

  it('is declared for upright, italic and medium, and is what the reply wears', () => {
    const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8')
    const shell = readFileSync(join(SRC, 'shell.css'), 'utf8')
    for (const file of FACES) {
      expect(tokens, file).toContain(`./assets/fonts/${file}.woff2`)
    }
    // Italic is declared AS italic, or the file is bundled for nothing.
    expect(tokens).toMatch(/IBMPlexSans-Italic\.woff2'\) format\('woff2'\);\s*font-weight: 400;\s*font-style: italic;/)
    // Never `swap` on a local face: nothing to swap from, and it can flash.
    expect(/IBM Plex Sans[\s\S]{0,400}font-display: swap/.test(tokens)).toBe(false)
    // The reply prose wears it; the rest of the app does not.
    expect(tokens).toContain("--lc-font-prose: 'IBM Plex Sans'")
    expect(shell).toMatch(/\.lc-agentline p \{[^}]*font-family: var\(--lc-font-prose\)/)
    expect(tokens).not.toMatch(/--lc-font-ui:[^;]*Plex/)
  })
})
