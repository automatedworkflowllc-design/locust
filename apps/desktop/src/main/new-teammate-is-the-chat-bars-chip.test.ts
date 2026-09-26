import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * Colin, 2026-09-26: "maybe make new teammate a proper button like the ones in
 * the chatbar, very clean, remember, no shortcuts". Not a lookalike: Home's New
 * teammate wears the composer's own chip rule, one selector list for both, so
 * a change to the chat bar's chips is a change to it.
 */
const read = (path: string): string => readFileSync(fileURLToPath(new URL(`../renderer/src/${path}`, import.meta.url)), 'utf8')

describe("Home's New teammate", () => {
  it("is drawn by the chat bar's own chip rule, and its hover", () => {
    const css = read('shell.css')
    expect(css).toContain('.lc-composer__controls .lc-control--boxed,\n.lc-chipbutton {')
    expect(css).toContain('.lc-composer__controls .lc-control--boxed:hover:not(:disabled),\n.lc-chipbutton:hover:not(:disabled) {')
  }, 10_000)

  it('is that chip on Home', () => {
    expect(read('components/HomeTeam.tsx')).toContain('className="lc-control lc-control--boxed lc-chipbutton"')
  }, 10_000)
})
