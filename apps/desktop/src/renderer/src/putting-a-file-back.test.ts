import { describe, expect, it } from 'vitest'

import { reverseChanges } from '../../shared/reverse-diff.js'
import { parseUnifiedDiff } from './diff.js'

/**
 * PUTTING A FILE BACK (0.502): the later turns' recorded changes undone,
 * exactly or not at all. Real unified diffs, read by the same parser the
 * thread draws them with.
 */
const change = (text: string) => {
  const [file] = parseUnifiedDiff(text)
  if (file === undefined) throw new Error('no file in diff')
  return file
}
const first = change(['--- a/notes.md', '+++ b/notes.md', '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three'].join('\n'))
const second = change(['--- a/notes.md', '+++ b/notes.md', '@@ -3,1 +3,2 @@', ' three', '+four'].join('\n'))

describe('a file two later turns changed', () => {
  it('is put back as it was before the first of them, newest change undone first', () => {
    expect(reverseChanges('one\nTWO\nthree\nfour\n', [first, second])).toEqual({ ok: true, next: 'one\ntwo\nthree\n' })
  })

  it('keeps Windows line endings', () => {
    expect(reverseChanges('one\r\nTWO\r\nthree\r\nfour\r\n', [first, second])).toEqual({ ok: true, next: 'one\r\ntwo\r\nthree\r\n' })
  })

  it('is left alone when it was changed after those turns', () => {
    const result = reverseChanges('one\nTWO, edited by hand\nthree\nfour\n', [first, second])
    expect(result).toEqual({ ok: false, why: 'it was changed after those replies' })
  })

  it('is left alone when a recorded change is incomplete', () => {
    const cut = { ...second, hunks: second.hunks.map((hunk) => ({ ...hunk, newCount: hunk.newCount + 3 })) }
    expect(reverseChanges('one\nTWO\nthree\nfour\n', [first, cut])).toMatchObject({ ok: false, why: 'its recorded change is incomplete' })
  })
})

describe('a file a later turn created', () => {
  const made = change(['--- /dev/null', '+++ b/fresh.txt', '@@ -0,0 +1,2 @@', '+hello', '+world'].join('\n'))

  it('is removed, when it is exactly what was created', () => {
    expect(reverseChanges('hello\nworld\n', [made])).toEqual({ ok: true, next: null })
  })

  it('is left alone when something was added to it since', () => {
    expect(reverseChanges('hello\nworld\nmine\n', [made])).toMatchObject({ ok: false })
  })

  it('created and then changed by the next turn, is removed', () => {
    const grown = change(['--- a/fresh.txt', '+++ b/fresh.txt', '@@ -2,1 +2,2 @@', ' world', '+again'].join('\n'))
    expect(reverseChanges('hello\nworld\nagain\n', [made, grown])).toEqual({ ok: true, next: null })
  })
})

describe('a file a later turn deleted', () => {
  const gone = change(['--- a/old.txt', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-kept', '-lines'].join('\n'))

  it('is brought back from a record of the whole file', () => {
    expect(reverseChanges(undefined, [gone])).toEqual({ ok: true, next: 'kept\nlines\n' })
  })

  it('is left alone when something is there again', () => {
    expect(reverseChanges('new\n', [gone])).toMatchObject({ ok: false })
  })
})
