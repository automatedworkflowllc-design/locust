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
    if (statSync(path).isDirectory()) {
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
