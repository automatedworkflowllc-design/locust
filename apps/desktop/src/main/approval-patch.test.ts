import { describe, expect, it } from 'vitest'

import { approvalPatchFrom, fileChangesOf, itemOf, relativeToFolder, unifiedPatchText } from './approval-patch.js'

const HUNK = '@@ -1,2 +1,2 @@\n-old line\n+new line\n context'
const WS = 'C:\\Users\\colin\\shop'

describe('the diff behind a file-change approval', () => {
  it('reads the changes off a fileChange item, and nothing off any other item', () => {
    const item = {
      id: 'item_1',
      type: 'fileChange',
      changes: [
        { path: 'src/a.ts', kind: { type: 'update' }, diff: HUNK },
        { path: 'src/new.ts', kind: { type: 'add' }, diff: 'hello\n' },
        { path: 'src/old.ts', kind: { type: 'delete' }, diff: 'bye\n' },
        { path: 'src/moved.ts', kind: { type: 'update', move_path: 'src/here.ts' }, diff: HUNK },
        { nonsense: true }
      ]
    }
    expect(fileChangesOf(item)?.map((c) => [c.path, c.kind, c.movePath])).toEqual([
      ['src/a.ts', 'update', undefined],
      ['src/new.ts', 'add', undefined],
      ['src/old.ts', 'delete', undefined],
      ['src/moved.ts', 'update', 'src/here.ts']
    ])
    expect(fileChangesOf({ id: 'x', type: 'commandExecution', command: 'ls' })).toBeUndefined()
    expect(itemOf({ item })).toEqual({ id: 'item_1', item })
    expect(itemOf({ item: { type: 'fileChange' } })).toBeUndefined()
  })

  it("the live payload: an add carries the file's content, not a hunk, and an absolute path -- both become a diff", () => {
    // Exactly what the app-server smoke recorded on 2026-09-05.
    const live = fileChangesOf({
      id: 'exec-7a33',
      type: 'fileChange',
      changes: [{ path: `${WS}\\SMOKE.txt`, kind: { type: 'add' }, diff: 'smoke ok.\n' }]
    })!
    expect(unifiedPatchText(live, WS)).toBe('--- /dev/null\n+++ b/SMOKE.txt\n@@ -0,0 +1,1 @@\n+smoke ok.')
    expect(approvalPatchFrom(live, WS)).toMatchObject({ added: 1, removed: 0, truncated: false })
  })

  it('composes a header pair per file: /dev/null for add and delete, the moved-to path for a move, hunks kept as sent for an update', () => {
    const text = unifiedPatchText(fileChangesOf({
      id: 'i',
      type: 'fileChange',
      changes: [
        { path: 'src/a.ts', kind: { type: 'update' }, diff: HUNK },
        { path: 'src/new.ts', kind: { type: 'add' }, diff: 'one\ntwo\n' },
        { path: 'src/old.ts', kind: { type: 'delete' }, diff: 'bye\n' },
        { path: 'src/moved.ts', kind: { type: 'update', move_path: 'src/here.ts' }, diff: HUNK }
      ]
    })!)
    expect(text.split('\n').filter((line) => line.startsWith('--- ') || line.startsWith('+++ '))).toEqual([
      '--- a/src/a.ts', '+++ b/src/a.ts',
      '--- /dev/null', '+++ b/src/new.ts',
      '--- a/src/old.ts', '+++ /dev/null',
      '--- a/src/moved.ts', '+++ b/src/here.ts'
    ])
    expect(text).toContain('@@ -0,0 +1,2 @@\n+one\n+two')
    expect(text).toContain('@@ -1,1 +0,0 @@\n-bye')
    const headed = '--- a/x.ts\n+++ b/x.ts\n' + HUNK
    expect(unifiedPatchText([{ path: 'x.ts', kind: 'update', movePath: undefined, diff: headed }])).toBe(headed)
  })

  it('paths under the folder are shown relative to it, whichever slashes and case; others are left alone', () => {
    expect(relativeToFolder('C:\\Users\\colin\\shop\\src\\a.ts', WS)).toBe('src/a.ts')
    expect(relativeToFolder('c:/users/colin/shop/src/a.ts', WS)).toBe('src/a.ts')
    expect(relativeToFolder('D:\\elsewhere\\a.ts', WS)).toBe('D:\\elsewhere\\a.ts')
    expect(relativeToFolder('src/a.ts', undefined)).toBe('src/a.ts')
  })

  it('counts the lines and bounds the text like the ledger does; no changes is no patch', () => {
    const patch = approvalPatchFrom([{ path: 'a.ts', kind: 'update', movePath: undefined, diff: HUNK }])
    expect(patch).toMatchObject({ added: 1, removed: 1, truncated: false })
    expect(approvalPatchFrom([])).toBeUndefined()
    expect(approvalPatchFrom(undefined)).toBeUndefined()
    const huge = approvalPatchFrom([{ path: 'big.ts', kind: 'add', movePath: undefined, diff: 'x\n'.repeat(40_000) }])
    expect(huge?.truncated).toBe(true)
    expect(huge?.added).toBe(40_000)
  })
})
