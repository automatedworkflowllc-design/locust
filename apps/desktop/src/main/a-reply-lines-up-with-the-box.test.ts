import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(`../renderer/src/${name}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const SHELL = read('shell.css')
const TOKENS = read('tokens.css')

/**
 * A REPLY LINES UP WITH THE BOX (0.529). Colin, 2026-10-01, beside a Claude
 * window: "they seem to align their chats with the chat bar". Measured by
 * _tools/probe-thread-column.mjs at 1209, 1440 and 1920: a reply's text runs
 * from where the box's typing starts to where it stops, the face hanging in
 * the margin. These pin the three rules that make it so.
 */
describe('a reply lines up with the box', () => {
  it('starts 16px inside the column, the box\'s own inset, with the face hanging left of it', () => {
    expect(SHELL).toMatch(/\.lc-thread__column \.lc-agentline \{\s*gap: var\(--lc-space-4\);\s*margin-left: calc\(var\(--lc-space-6\) - 24px - var\(--lc-space-4\)\);\s*\/\*[^*]*\*\/\s*margin-right: var\(--lc-space-6\);/)
  })

  it('fills the column: a paragraph has no measure of its own', () => {
    const paragraph = SHELL.slice(SHELL.indexOf('.lc-agentline p {'), SHELL.indexOf('.lc-agentline p {') + 9000)
    expect(paragraph).toMatch(/max-width: none;\s*line-height: 1\.7;/)
    expect(paragraph.slice(0, paragraph.indexOf('line-height: 1.7;'))).not.toMatch(/max-width: \d+ch;/)
  })

  it('keeps a line readable on a big window with the column\'s ceiling', () => {
    expect(TOKENS).toContain('--lc-thread-max-width: clamp(760px, 68vw, 840px);')
    expect(TOKENS).toContain('--lc-thread-max-width-compact: clamp(700px, 84vw, 840px);')
  })
})
