import { describe, expect, it } from 'vitest'

import { unifiedPatchText } from '../../shared/approval-patch.js'
import { parseUnifiedDiff } from './diff.js'

/**
 * The card draws what the host composed with the same parser the activity
 * fold uses. This is the round trip: what Codex sends, through the host's
 * composition, into the files the viewer draws.
 */
describe('an approval patch parses back into files the card can draw', () => {
  it("the live add (content, not a hunk; absolute path) becomes one ADDED file with one hunk", () => {
    const text = unifiedPatchText(
      [{ path: 'C:\\Users\\colin\\shop\\SMOKE.txt', kind: 'add', movePath: undefined, diff: 'smoke ok.\n' }],
      'C:\\Users\\colin\\shop'
    )
    const files = parseUnifiedDiff(text)
    expect(files.map((file) => [file.path, file.status, file.hunks.length])).toEqual([['SMOKE.txt', 'ADDED', 1]])
    expect(files[0]?.hunks[0]?.rows.map((row) => [row.kind, row.text])).toEqual([['add', 'smoke ok.']])
  })

  it('update, add, delete and move each keep their status and path', () => {
    const files = parseUnifiedDiff(
      unifiedPatchText([
        { path: 'src/a.ts', kind: 'update', movePath: undefined, diff: '@@ -1,2 +1,2 @@\n-old line\n+new line\n context' },
        { path: 'src/new.ts', kind: 'add', movePath: undefined, diff: 'one\ntwo\n' },
        { path: 'src/old.ts', kind: 'delete', movePath: undefined, diff: 'bye\n' },
        { path: 'src/moved.ts', kind: 'update', movePath: 'src/here.ts', diff: '@@ -1 +1 @@\n-x\n+y' }
      ])
    )
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ['src/a.ts', 'MODIFIED'],
      ['src/new.ts', 'ADDED'],
      ['src/old.ts', 'DELETED'],
      ['src/here.ts', 'RENAMED']
    ])
  })
})
