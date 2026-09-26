import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE APP'S OWN VOICE IS ON DISK, and its titles are set the way the
 * wordmark is.
 *
 * Colin picked direction B from the 2026-09-22 type trials: Figtree for
 * everything the app says, and screen and section titles in bold capitals,
 * spaced wide. The CSP pins `font-src 'self'`, so a face named in the token
 * and not bundled would fall back to the next one silently -- the app would
 * look exactly as it did and nothing would say so. This is the check that
 * would.
 */

const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const FONTS = join(SRC, 'assets', 'fonts')
const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8')
const shell = readFileSync(join(SRC, 'shell.css'), 'utf8')

const uiFace = (/--lc-font-ui:\s*'([^']+)'/.exec(tokens) ?? [])[1]

function filesFor(family: string): readonly string[] {
  const found: string[] = []
  let at = tokens.indexOf('@font-face')
  while (at >= 0) {
    const open = tokens.indexOf('{', at)
    const close = tokens.indexOf('}', open)
    const block = tokens.slice(open + 1, close)
    if (new RegExp(String.raw`font-family:\s*'${family}'`).test(block)) {
      for (const [, file] of block.matchAll(/assets\/fonts\/([^']+)\.woff2/g)) found.push(file!)
    }
    at = tokens.indexOf('@font-face', close)
  }
  return found
}

const rule = (selector: string): string => {
  const start = shell.indexOf(`${selector} {`)
  return start < 0 ? '' : shell.slice(start, shell.indexOf('}', start))
}

describe("the app's voice", () => {
  it('is Figtree, with Geist behind it for what Figtree does not draw', () => {
    expect(uiFace).toBe('Figtree')
    expect(tokens).toMatch(/--lc-font-ui:\s*'Figtree',\s*'Geist',/)
  })

  it('is a real woff2 on disk for both styles, covering the title weight', () => {
    const files = filesFor('Figtree')
    expect(files).toEqual(['Figtree-Variable', 'Figtree-Italic-Variable'])
    for (const name of files) {
      const path = join(FONTS, `${name}.woff2`)
      expect(statSync(path).size, name).toBeGreaterThan(20_000)
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), name).toBe('wOF2')
    }
    // A variable range that stops short of 700 would synthesise the titles.
    expect(tokens).toMatch(/font-family: 'Figtree';[^}]*font-weight: 300 900;/)
  })

  it('carries its licence beside it', () => {
    expect(readFileSync(join(FONTS, 'FIGTREE-LICENSE.txt'), 'utf8')).toContain('SIL Open Font License')
  })
})

describe('a title is set the way the wordmark is', () => {
  it("a screen's title takes the title tokens, in capitals", () => {
    const body = rule('.lc-screen__title')
    expect(body).toContain('font-weight: var(--lc-title-weight)')
    expect(body).toContain('letter-spacing: var(--lc-title-tracking)')
    expect(body).toContain('text-transform: uppercase')
    expect(tokens).toMatch(/--lc-title-weight: 700;/)
  })

  it('a section inside a screen is a sentence, one step above its text (Colin, 0.356)', () => {
    // Shown both ways side by side (heading-case-question); he chose this.
    const body = rule('.lc-settings__heading')
    expect(body).toContain('font-size: var(--lc-text-section)')
    expect(body).not.toContain('text-transform')
    expect(body).not.toContain('var(--lc-title-tracking)')
    expect(tokens).toMatch(/--lc-text-section: 16px;/)
  })

  it('a section label below a title stays a label, not a second title', () => {
    // `--section` is declared after the heading at the same specificity, so
    // it wins -- as long as it restates every property the heading sets.
    const body = rule('.lc-settings__heading--section')
    for (const property of ['font-size', 'font-weight', 'letter-spacing', 'text-transform']) {
      expect(body, property).toContain(`${property}:`)
    }
    expect(shell.indexOf('.lc-settings__heading--section {')).toBeGreaterThan(shell.indexOf('.lc-settings__heading {'))
  })

  it('a name inside a title keeps its own spelling', () => {
    expect(rule('.lc-title__name')).toContain('text-transform: none')
  })
})
