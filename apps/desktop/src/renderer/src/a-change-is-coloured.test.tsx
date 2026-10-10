import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { colourCode } from './codeColors.js'
import { DiffView } from './components/DiffView.js'
import { pairedSpans, parseUnifiedDiff } from './diff.js'
import { hunkSides, paintRow } from './diffColours.js'

/*
 * A CHANGE'S CODE, IN COLOUR (0.725). Shiki is run for real, as for code in a reply (0.719); nothing is mocked.
 */
;(globalThis as { window?: unknown }).window = { desktop: { platform: 'win32' } }

const edit = [
  '--- a/src/cart.ts',
  '+++ b/src/cart.ts',
  '@@ -1,4 +1,4 @@',
  ' /* the cart,',
  '    priced */',
  '-export const total = (items: number[]) => sum(items) * 2',
  '+export const total = (items: number[]) => sum(items)',
  ' const label = "done"'
].join('\n')
const file = parseUnifiedDiff(edit)[0]!
const hunk = file.hunks[0]!

describe('a change’s code', () => {
  it('is coloured as its two sides read, each a whole piece of code', () => {
    const sides = hunkSides(hunk)
    expect(sides.before.split('\n')).toEqual(['/* the cart,', '   priced */', 'export const total = (items: number[]) => sum(items) * 2', 'const label = "done"'])
    expect(sides.after.split('\n')).toEqual(['/* the cart,', '   priced */', 'export const total = (items: number[]) => sum(items)', 'const label = "done"'])
    const removed = hunk.rows.find((row) => row.kind === 'del')!
    const added = hunk.rows.find((row) => row.kind === 'add')!
    expect(sides.at.get(removed)).toEqual({ side: 'before', line: 2 })
    expect(sides.at.get(added)).toEqual({ side: 'after', line: 2 })
  })

  it('keeps every character, the changed words marked over the colours', async () => {
    const sides = hunkSides(hunk)
    const before = (await colourCode(sides.before, 'ts'))!
    const removed = hunk.rows.find((row) => row.kind === 'del')!
    const runs = paintRow(removed.text, before[2], pairedSpans(hunk.rows).get(removed))
    expect(runs.map((run) => run.text).join('')).toBe(removed.text)
    expect(runs.some((run) => run.color === 'var(--shiki-token-keyword)')).toBe(true)
    expect(runs.filter((run) => run.changed).map((run) => run.text).join('')).toBe(' * 2')
    // The second line of the comment is a comment, as the grammar sees the whole piece.
    expect(before[1]!.every((token) => token.color === undefined || /comment/.test(token.color))).toBe(true)
  })

  it('is drawn plain when the colours do not spell the row', () => {
    expect(paintRow('abc', [{ content: 'xyz', color: 'var(--shiki-token-keyword)' }], undefined)).toEqual([{ text: 'abc', changed: false }])
    expect(paintRow('abc', undefined, undefined)).toEqual([{ text: 'abc', changed: false }])
  })

  it('shows in the diff once its grammar has coloured it', async () => {
    const sides = hunkSides(hunk)
    await Promise.all([colourCode(sides.before, 'ts'), colourCode(sides.after, 'ts')])
    const html = renderToStaticMarkup(<DiffView file={file} truncated={false} reported={undefined} />)
    expect(html).toContain('style="color:var(--shiki-token-keyword)"')
    expect(html).toContain('<mark class="lc-diff__word">')
    // A file Locust has no grammar for stays plain.
    const plain = renderToStaticMarkup(<DiffView file={{ ...file, path: 'notes.txt' }} truncated={false} reported={undefined} />)
    expect(plain).not.toContain('--shiki-token')
  })
})
