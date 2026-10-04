import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The teammate's voice is a real, bundled face, whichever face it is.
 *
 * A `@font-face` naming a file that is not there does not warn: the rule
 * silently falls through to the next family in the stack, and the reply
 * quietly goes back to wearing the app's voice. Nothing on screen would say
 * so.
 *
 * This used to name IBM Plex in every assertion, and went red the moment the
 * face changed on 2026-09-13 -- for a taste decision, not a defect. Which
 * face carries a reply is Colin's to choose; that it is REAL, bundled,
 * licensed, and actually reaches the reply is the promise. So the face is
 * read out of the token and everything else is checked against whatever it
 * says.
 */

const SRC = fileURLToPath(new URL('../renderer/src/', import.meta.url))
const FONTS = join(SRC, 'assets', 'fonts')
const tokens = readFileSync(join(SRC, 'tokens.css'), 'utf8')
const shell = readFileSync(join(SRC, 'shell.css'), 'utf8')

/** The first family in `--lc-font-prose`: the one a reply actually wears. */
const proseFace = (/--lc-font-prose:\s*'([^']+)'/.exec(tokens) ?? [])[1]

/** Every `@font-face` block in tokens.css, read without regex braces. */
function fontFaceBlocks(): readonly string[] {
  const blocks: string[] = []
  let at = tokens.indexOf('@font-face')
  while (at >= 0) {
    const open = tokens.indexOf('{', at)
    const close = tokens.indexOf('}', open)
    if (open < 0 || close < 0) break
    blocks.push(tokens.slice(open + 1, close))
    at = tokens.indexOf('@font-face', close)
  }
  return blocks
}

/** Every file the `@font-face` rule for that family points at. */
function filesFor(family: string): readonly string[] {
  const found: string[] = []
  for (const block of fontFaceBlocks()) {
    // `String.raw`: a plain template eats the escape and leaves
    // `font-family:s*`, which matches nothing. Same trap as the harnesses.
    if (!new RegExp(String.raw`font-family:\s*'${family}'`).test(block)) continue
    for (const [, file] of block.matchAll(/assets\/fonts\/([^']+)\.woff2/g)) found.push(file)
  }
  return found
}

describe("the teammate's voice", () => {
  it('is named by the token, so the rest of this file knows what to check', () => {
    expect(proseFace, '--lc-font-prose names no family').toBeDefined()
  })

  it('is a real woff2 on disk, not a name the stack falls through', () => {
    const files = filesFor(proseFace!)
    expect(files.length, `no @font-face declares ${String(proseFace)}`).toBeGreaterThan(0)
    for (const name of files) {
      const path = join(FONTS, `${name}.woff2`)
      expect(statSync(path).size, name).toBeGreaterThan(20_000)
      // The WOFF2 signature, so a 404 page saved as a .woff2 cannot pass.
      expect(readFileSync(path).subarray(0, 4).toString('latin1'), name).toBe('wOF2')
    }
  })

  it('carries a licence beside it, which is the obligation bundling brings', () => {
    const licences = readFileSync(join(FONTS, 'ANTHROPIC-FONTS-LICENSE.txt'), 'utf8')
      + readFileSync(join(FONTS, 'IBM-Plex-LICENSE.txt'), 'utf8')
      + readFileSync(join(FONTS, 'GEIST-LICENSE.txt'), 'utf8')
    expect(licences).toContain('SIL Open Font License')
    expect(licences).toContain('MIT License')
  })

  it('never uses `swap` on a local face, which can flash the wrong one', () => {
    /*
     * Nothing to swap FROM: the file is on disk before the first paint.
     *
     * Written with `fontFaceBlocks` rather than a regex because
     * `tests-assert-something` slices a test body by counting braces, and a
     * `[^}]` inside a regex literal closes the slice early -- so this test's
     * assertions were invisible to it and it was correctly reported as
     * checking nothing.
     */
    const local = fontFaceBlocks().filter((block) => block.includes('assets/fonts/'))
    // Counted first: a loop over nothing asserts nothing.
    expect(local.length).toBeGreaterThan(3)
    for (const block of local) {
      expect(block, block.slice(0, 60)).not.toContain('font-display: swap')
    }
  })

  it('never lets the browser invent a face the family does not ship', () => {
    /*
     * The defect this exists for, found 2026-09-19 by the design agent's
     * release check and confirmed against the repo: only
     * `AnthropicSerif-Variable.woff2` ships and it is `font-style: normal`,
     * with no italic beside it -- while `agentText.ts` turns every `*text*`
     * into an `<em>`. So every emphasis in every reply was a browser-
     * synthesised slant of the upright, which is precisely what the comment
     * above the rule claimed the app did not do. The comment had been true
     * of IBM Plex and went stale the day the face changed.
     *
     * The invariant, which holds whichever face is chosen next: if the prose
     * family ships no italic file, nothing in a reply may ask for one.
     */
    const italics = filesFor(proseFace!).filter((name) => /italic|oblique/i.test(name))
    if (italics.length > 0) return
    expect(shell, 'the prose face ships no italic, so synthesis must be off').toMatch(
      /\.lc-agentline \{[^}]*font-synthesis: none/
    )
    // And emphasis must still be VISIBLE: `font-synthesis: none` on its own
    // would render `<em>` identically to body text and lose the mark
    // silently, which is a worse lie than the slant was.
    expect(shell).toMatch(/\.lc-agentline p em[^{]*\{[^}]*font-weight:/)
    expect(shell).toMatch(/\.lc-agentline p em[^{]*\{[^}]*font-style: normal/)
  })

  it('is what the reply wears, and is not the app talking', () => {
    expect(shell).toMatch(/\.lc-agentline__body \{[^}]*font-family: var\(--lc-font-prose\)/)
    // A reply in the app's own face is the defect this token exists to fix.
    const uiFace = (/--lc-font-ui:\s*'([^']+)'/.exec(tokens) ?? [])[1]
    expect(proseFace).not.toBe(uiFace)
  })
})
