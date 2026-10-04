import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every test in this repository asserts something.
 *
 * A test with no assertion is not a weak test, it is not a test: it runs the
 * code, throws nothing, and reports success no matter what the code did. Worse
 * than the missing coverage is what it does to everything around it — a suite
 * with one of these in it can no longer be read as evidence, because you can
 * no longer tell a green that means "checked" from a green that means "ran".
 *
 * This is not hypothetical here. A sibling project shipped a live `verify.js`
 * containing zero assertions; it printed findings for a human and exited 0
 * whatever happened, and it was only caught by replacing its whole findings
 * function with `return []` and watching it still pass.
 *
 * The sweep found ZERO on the day it was written — 1,552 test bodies, all
 * asserting. So this adds no fixes. It exists because the cost of the class is
 * total and the cost of the check is a regex.
 *
 * It is deliberately generous about what counts: `expect(`, any `assert`, or a
 * `toThrow`. A test using some other assertion helper would be a false alarm,
 * and the answer to that is to widen this list rather than to delete a test.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SKIP = ['node_modules', '.git', 'dist', 'release', 'out']

function testFiles(at: string, found: string[] = []): string[] {
  for (const name of readdirSync(at)) {
    if (SKIP.includes(name)) continue
    const path = join(at, name)
    // Other suites make and remove scratch folders while this walks (0.563's
    // ship gate): one gone between the listing and the look is skipped.
    let info: ReturnType<typeof statSync>
    try {
      info = statSync(path)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      testFiles(path, found)
      continue
    }
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) found.push(path)
  }
  return found
}

const OPENS = /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(\s*(['"`])(.*?)\1\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/gs

/** The bodies of every test in one file, by brace balance from the callback. */
function testBodies(text: string): { readonly title: string; readonly body: string }[] {
  const bodies: { title: string; body: string }[] = []
  for (const match of text.matchAll(OPENS)) {
    const open = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let end = text.length
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    bodies.push({ title: match[2] ?? '', body: text.slice(open + 1, end) })
  }
  return bodies
}

function asserts(body: string): boolean {
  return body.includes('expect(') || body.includes('assert') || body.includes('toThrow')
}

const files = testFiles(ROOT)

describe('no test can pass without checking anything', () => {
  it('found the tests at all, and can tell an assertion-free body from a real one', () => {
    // The control. Without it a broken walk or a broken regex would report
    // zero assertion-free tests by finding zero tests, which is the same
    // green.
    expect(files.length).toBeGreaterThan(50)
    const scanned = files.reduce((count, path) => count + testBodies(readFileSync(path, 'utf8')).length, 0)
    expect(scanned).toBeGreaterThan(1_000)
    expect(asserts('const unused = 1\n  void unused')).toBe(false)
    expect(asserts('expect(1).toBe(1)')).toBe(true)
  })

  it.each(files.map((path) => path.slice(ROOT.length)))('%s', (relative: string) => {
    const text = readFileSync(join(ROOT, relative), 'utf8')
    const bare = testBodies(text)
      .filter((entry) => !asserts(entry.body))
      .map((entry) => entry.title)
    expect(bare).toEqual([])
  })
})

/**
 * And no test decides where its own sources are by asking the shell.
 *
 * Two tests built their paths as `join(process.cwd(), 'apps/desktop/src', ...)`.
 * That is right only when vitest is started from the repository root. The ship
 * gate starts it there and was green; `pnpm test` starts it inside
 * apps/desktop, where the path doubles and all seven cases die on ENOENT.
 *
 * The failure mode is not that a test broke -- it is that the suite had two
 * different answers depending on how it was invoked, and the invocation that
 * gated releases was the one that passed. A green from the gate no longer
 * meant the suite was green. That is the same disease as an assertion-free
 * test, one level up, so it is pinned in the same file.
 *
 * `import.meta.url` is the fix and the rule: a test's sources sit at a fixed
 * place relative to the test, never relative to whoever ran it.
 */
/*
 * The needle is assembled rather than written, so that this file does not
 * contain the very text it forbids. The first version did, and flagged
 * itself along with the explanatory comment in the file it had just fixed --
 * a detector that reads prose as code, which is the third time today a
 * detector's own finding turned out to be the detector's.
 */
const CWD_CALL = `${'process'}.${'cwd'}()`

/** Source with comments removed, so a note ABOUT the rule is not a breach of it. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n]*?\/\/[^\n]*$/gm, ' ')
}

describe('no test resolves its sources from the working directory', () => {
  it('found the tests, and can tell the call from a note about it', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(codeOnly(`const p = join(${CWD_CALL}, 'src')`)).toContain(CWD_CALL)
    expect(codeOnly(`// never use ${CWD_CALL} here`)).not.toContain(CWD_CALL)
    expect(codeOnly(`/* a note about ${CWD_CALL} */`)).not.toContain(CWD_CALL)
    expect(codeOnly("const SRC = fileURLToPath(new URL('../', import.meta.url))")).not.toContain(CWD_CALL)
  })

  it('every test file resolves from import.meta.url instead', () => {
    const cwdBound = files
      .filter((path) => codeOnly(readFileSync(path, 'utf8')).includes(CWD_CALL))
      .map((path) => path.slice(ROOT.length))
    expect(cwdBound).toEqual([])
  })
})
