import { describe, expect, it } from 'vitest'

import {
  completenessOf,
  countRows,
  fileCounts,
  foldContext,
  hunkRange,
  pairedSpans,
  parseUnifiedDiff,
  wordDiff
} from './diff.js'

// A patch as Cursor actually emits one (absolute path, no `diff --git`),
// followed by one as Codex's tooling would (a/ b/ prefixes, two hunks).
const CURSOR_ADD = '--- /dev/null\n+++ b/C:\\work\\scratch\\NOTES.md\n@@ -1,0 +1 @@\n+hello\n'

const TWO_HUNKS = [
  'diff --git a/src/billing.ts b/src/billing.ts',
  '--- a/src/billing.ts',
  '+++ b/src/billing.ts',
  '@@ -12,4 +12,6 @@ registerHandlers()',
  ' export function registerHandlers(app: App) {',
  '   app.post("/hooks/billing/v2", handleV2);',
  '-  app.post("/hooks/billing/v3", handleV3);',
  '+  if (flags.billingV3) {',
  '+    app.post("/hooks/billing/v3", handleV3);',
  '+  }',
  ' }',
  '@@ -41,4 +43,6 @@ handleV3()',
  ' async function handleV3(req: Request) {',
  '-  return old(req);',
  '+  const body = parse(req);',
  '+  return next(body);',
  '+  // logged',
  ' }',
  ''
].join('\n')

describe('reading a unified diff', () => {
  it('reads an added file the way Cursor writes one', () => {
    const [file] = parseUnifiedDiff(CURSOR_ADD)
    expect(file?.status).toBe('ADDED')
    expect(file?.path).toBe('C:\\work\\scratch\\NOTES.md')
    expect(file?.hunks).toHaveLength(1)
    expect(file?.hunks[0]?.rows).toEqual([{ kind: 'add', newNo: 1, text: 'hello' }])
  })

  it('reads a modified file with two hunks and their headings', () => {
    const [file] = parseUnifiedDiff(TWO_HUNKS)
    expect(file?.status).toBe('MODIFIED')
    expect(file?.path).toBe('src/billing.ts')
    expect(file?.hunks.map((hunk) => hunk.heading)).toEqual(['registerHandlers()', 'handleV3()'])
    expect(file?.hunks[0]?.rows.map((row) => row.kind)).toEqual(['context', 'context', 'del', 'add', 'add', 'add', 'context'])
  })

  it('numbers lines from the hunk start, on each side', () => {
    const [file] = parseUnifiedDiff(TWO_HUNKS)
    const rows = file!.hunks[0]!.rows
    expect(rows[0]).toMatchObject({ oldNo: 12, newNo: 12 })
    expect(rows[2]).toMatchObject({ kind: 'del', oldNo: 14 })
    expect(rows[3]).toMatchObject({ kind: 'add', newNo: 14 })
    expect(rows[6]).toMatchObject({ kind: 'context', oldNo: 15, newNo: 17 })
  })
})

describe('counts are derived, never authored', () => {
  it('computes a file total from its rows alone', () => {
    const [file] = parseUnifiedDiff(TWO_HUNKS)
    expect(fileCounts(file!)).toEqual({ added: 6, removed: 2 })
  })

  it('rebuilds each @@ range from its rows, and it agrees with what was written', () => {
    const [file] = parseUnifiedDiff(TWO_HUNKS)
    expect(hunkRange(file!.hunks[0]!)).toBe('@@ -12,4 +12,6 @@')
    // The fixture's own header says 4 and 6. Its rows say 3 and 5. The rows
    // win, which is the rule -- and I typed that header myself.
    expect(hunkRange(file!.hunks[1]!)).toBe('@@ -41,3 +43,5 @@')
  })

  it('does not trust a header that disagrees with its rows', () => {
    // The runtime claims 60 added lines; two are present. The range shown
    // describes the two, because a reviewer will trust the wrong number.
    const lying = '--- a/x\n+++ b/x\n@@ -1,1 +1,61 @@\n-a\n+b\n+c\n'
    const [file] = parseUnifiedDiff(lying)
    expect(hunkRange(file!.hunks[0]!)).toBe('@@ -1 +1,2 @@')
    expect(countRows(file!.hunks[0]!.rows)).toEqual({ added: 2, removed: 1 })
  })
})

describe('folding unchanged lines', () => {
  const rows = parseUnifiedDiff(
    // Fourteen rows, one replacement at the eighth: four lines fold before
    // it, three stay either side, two fold after it.
    ['--- a/x', '+++ b/x', '@@ -1,13 +1,13 @@']
      .concat(Array.from({ length: 14 }, (_, i) => (i === 7 ? '-seven' : i === 8 ? '+SEVEN' : ` line ${String(i)}`)))
      .join('\n')
  )[0]!.hunks[0]!.rows

  it('keeps three lines either side of a change and folds the rest with an exact count', () => {
    const segments = foldContext(rows)
    expect(segments.map((segment) => segment.kind)).toEqual(['fold', 'rows', 'fold'])
    const first = segments[0]
    expect(first?.kind === 'fold' ? first.count : -1).toBe(4)
    const last = segments[2]
    expect(last?.kind === 'fold' ? last.count : -1).toBe(2)
  })

  it('never folds a change, only context', () => {
    for (const segment of foldContext(rows)) {
      if (segment.kind === 'fold') expect(segment.rows.every((row) => row.kind === 'context')).toBe(true)
    }
  })
})

describe('no open file ends in silence', () => {
  const [file] = parseUnifiedDiff(TWO_HUNKS)

  it('says all hunks are shown when they are', () => {
    const done = completenessOf(file!, 2, false)
    expect(done.statement).toBe('All 2 hunks shown')
    expect(done.canExpand).toBe(false)
  })

  it('offers to expand, naming exactly what remains', () => {
    const partial = completenessOf(file!, 1, false)
    expect(partial.statement).toBe('Expand full file · 1 hunk more, 4 lines')
    expect(partial.canExpand).toBe(true)
    expect(partial.remainingLines).toBe(4)
  })

  it('states a remainder it could not render, rather than nothing', () => {
    const cut = completenessOf(file!, 2, true)
    expect(cut.statement).toContain('the rest was not recorded inline')
    expect(cut.canExpand).toBe(false)
  })

  it('cannot produce an empty statement for any input', () => {
    for (const shown of [-1, 0, 1, 2, 99]) {
      for (const truncated of [false, true]) {
        expect(completenessOf(file!, shown, truncated).statement.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('marking only what changed on a line', () => {
  it('leaves the common prefix and suffix plain', () => {
    const { old, next } = wordDiff('  app.post("/v2", handleV2);', '  app.post("/v3", handleV3);')
    expect(old.filter((span) => span.changed).map((span) => span.text)).toEqual(['2", handleV2'])
    expect(next.filter((span) => span.changed).map((span) => span.text)).toEqual(['3", handleV3'])
  })

  it('pairs a removed line with the added line that replaced it, positionally', () => {
    const [file] = parseUnifiedDiff(TWO_HUNKS)
    const rows = file!.hunks[1]!.rows
    const spans = pairedSpans(rows)
    const del = rows.find((row) => row.kind === 'del')!
    const firstAdd = rows.find((row) => row.kind === 'add')!
    expect(spans.has(del)).toBe(true)
    expect(spans.has(firstAdd)).toBe(true)
    // The second and third additions had no removal to pair with.
    const unpaired = rows.filter((row) => row.kind === 'add').slice(1)
    expect(unpaired.every((row) => !spans.has(row))).toBe(true)
  })
})

/*
 * M22 (the code review): a content line beginning `--- ` or `+++ ` inside a
 * hunk was read as a new file's header. Deleting a SQL comment split the file
 * and made a phantom one; adding `++ world` renamed the file. The approval
 * card draws this parser, so a person was asked to approve a change whose
 * diff showed nothing changing.
 */
describe('a line inside a hunk that looks like a header', () => {
  const NL = String.fromCharCode(10)
  it('keeps a removed SQL comment as a removed line', () => {
    const text = [
      '--- a/db/schema.sql',
      '+++ b/db/schema.sql',
      '@@ -1,3 +1,3 @@',
      ' CREATE TABLE t (',
      '--- legacy column, remove me',
      '+  id INTEGER',
      ' );'
    ].join(NL)
    const files = parseUnifiedDiff(text)
    expect(files).toHaveLength(1)
    expect(files[0]?.path).toBe('db/schema.sql')
    expect(files[0]?.status).toBe('MODIFIED')
    expect(fileCounts(files[0]!)).toEqual({ added: 1, removed: 1 })
    expect(files[0]?.hunks[0]?.rows.map((row) => row.kind)).toEqual(['context', 'del', 'add', 'context'])
    expect(files[0]?.hunks[0]?.rows[1]?.text).toBe('-- legacy column, remove me')
  })

  it('keeps an added line beginning ++ as an added line, not a rename', () => {
    const text = ['--- a/notes.txt', '+++ b/notes.txt', '@@ -1 +1,2 @@', ' hello', '+++ world'].join(NL)
    const files = parseUnifiedDiff(text)
    expect(files).toEqual([expect.objectContaining({ path: 'notes.txt', status: 'MODIFIED' })])
    expect(fileCounts(files[0]!)).toEqual({ added: 1, removed: 0 })
  })

  it('still starts the next file once a hunk is used up', () => {
    const text = [
      '--- a/one.sql', '+++ b/one.sql', '@@ -1 +1 @@', '--- old', '+-- new',
      '--- a/two.txt', '+++ b/two.txt', '@@ -1 +1 @@', '-a', '+b'
    ].join(NL)
    expect(parseUnifiedDiff(text).map((file) => [file.path, fileCounts(file)])).toEqual([
      ['one.sql', { added: 1, removed: 1 }],
      ['two.txt', { added: 1, removed: 1 }]
    ])
  })
})
