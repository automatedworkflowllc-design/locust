import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * No tracked file carries a control character it did not mean to.
 *
 * This exists because a shell keeps writing them here. Passing text through a
 * heredoc interprets backslash escapes, and the result is a file that looks
 * right in a diff and is quietly wrong. Four times in one day, three files:
 *
 *   a newline escape became a REAL newline inside a template literal, which
 *   broke a test file outright -- vitest reported "no tests" and the failure
 *   read like a bug in the code under test
 *
 *   a doubled backslash was eaten, leaving a Windows path split on a separator
 *   that was no longer there, so the check could never match and its silent
 *   "no hit" read exactly like a pass
 *
 *   a backslash-a became a real BELL (0x07) in the middle of a plan document,
 *   and was committed
 *
 * The rule is to use an editor for anything containing escapes, and the rule
 * was known each time -- so a rule is evidently not the control. This is.
 *
 * Tab, newline and carriage return are ordinary text. Everything else below a
 * space, plus DEL, is something a shell did on the way past.
 *
 * The pattern below is built from a STRING of escape sequences rather than
 * written as a literal character class, so that every byte of this file is
 * printable. A first version of this test was itself written by pasting the
 * class through a shell, which put four real control characters into the
 * matcher -- the test would have flagged its own source, which is a memorable
 * but expensive way to learn the lesson twice.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'release', 'user-session'])
const TEXT = ['.ts', '.tsx', '.mjs', '.js', '.json', '.css', '.md', '.html', '.yml', '.yaml']

/** Below a space and not tab (09), newline (0A) or carriage return (0D); plus DEL (7F). */
const STRAY = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]')

function textFiles(at: string, found: string[] = []): string[] {
  for (const name of readdirSync(at)) {
    if (SKIP.has(name)) continue
    const path = join(at, name)
    if (statSync(path).isDirectory()) {
      textFiles(path, found)
      continue
    }
    if (TEXT.some((end) => name.endsWith(end))) found.push(path)
  }
  return found
}

const files = textFiles(ROOT)

describe('no file carries a control character a shell left behind', () => {
  it('found files to check, and the matcher can tell a stray from a tab', () => {
    // Without this, a wrong path or an over-narrow pattern reports a clean
    // tree by looking at nothing.
    expect(files.length).toBeGreaterThan(200)
    expect(STRAY.test('ordinary\ttext\r\nwith whitespace')).toBe(false)
    expect(STRAY.test(`a bell ${String.fromCharCode(7)} here`)).toBe(true)
    expect(STRAY.test(`a null ${String.fromCharCode(0)} here`)).toBe(true)
    expect(STRAY.test(`an escape ${String.fromCharCode(27)} here`)).toBe(true)
    expect(STRAY.test(`a delete ${String.fromCharCode(127)} here`)).toBe(true)
  })

  it('every tracked text file is clean', () => {
    const dirty = files
      .filter((path) => STRAY.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length))
    expect(dirty).toEqual([])
  })
})
