import { describe, expect, it } from 'vitest'

import { FILE_BLOCK_EXAMPLE_PATH, FILE_TAG, parseFileBlocks } from './handover.js'

/**
 * THE EXAMPLE FILE IS NEVER A FILE (0.495). Grok's 0.489 pass: under a reply
 * the thread drew "path/relative/to/the/folder.md" as a file handed over --
 * the example in the teammate's briefing, copied back by a small model. No
 * such file exists, so the block's example is never taken for one.
 */
describe('a file block', () => {
  it('ignores the briefing example, and keeps a real file beside it', () => {
    const reply = `Done.\n<${FILE_TAG}>\n${FILE_BLOCK_EXAMPLE_PATH} :: what it is, in a few words\nindex.html :: the todo page\n</${FILE_TAG}>`
    expect(parseFileBlocks(reply).map((file) => file.path)).toEqual(['index.html'])
  })
})
