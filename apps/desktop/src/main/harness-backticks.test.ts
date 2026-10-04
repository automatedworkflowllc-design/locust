import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * No harness ends a template literal inside one of its own comments.
 *
 * The drives build their browser scripts as template literals, and those
 * scripts carry comments. A BACKTICK in one of them ends the literal there:
 * what the author meant as script text becomes JavaScript in the harness, and
 * what they meant as a comment becomes a string.
 *
 * `harness-syntax.test.ts` runs `node --check` over every harness and CANNOT
 * catch this: the file still parses. That is the whole reason this exists.
 * The failure only shows up when the drive is next run, as a browser-side
 * error about an undefined identifier -- on 2026-09-09, `thread__marker is not
 * defined`, from a comment reading "this also required `.lc-thread__marker`".
 * It has cost this session six separate times, and every previous fix was a
 * rule rather than a control.
 *
 * The detector is exact rather than heuristic. Harness comments quote code in
 * backticks constantly and legitimately, so flagging every backtick near a
 * comment would be noise. What is never legitimate is a template literal whose
 * CLOSING backtick sits inside a comment: that is not a quote, it is the
 * literal ending somewhere nobody intended.
 */

const TOOLS = fileURLToPath(new URL('../../../../_tools/', import.meta.url))
const SMOKE = fileURLToPath(new URL('../../../../_smoke/', import.meta.url))

function harnesses(): readonly string[] {
  const found: string[] = []
  for (const directory of [TOOLS, SMOKE]) {
    let names: readonly string[]
    try {
      names = readdirSync(directory)
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(directory, name)
      if (name.endsWith('.mjs') && statSync(path).isFile()) found.push(path)
    }
  }
  return found.sort()
}

/**
 * The lines where a template literal ends inside a comment.
 *
 * Two kinds of comment live in these files and only one of them can do this.
 *
 * A comment in the HARNESS is ordinary JavaScript, and a backtick in it is
 * just a character -- `harness-syntax` and the parser agree, nothing to find.
 *
 * A comment in the embedded BROWSER SCRIPT is different: to Node that text is
 * the inside of a template literal, so a backtick there closes the literal
 * early. Those comments are always written on their own line -- that is what
 * separates them from the `//` in `http://127.0.0.1`, which is not a comment
 * at all and which the first version of this scanner flagged on 49 files.
 *
 * `${...}` is tracked properly because inside it the rules flip back: that
 * span is real code again, comments and nested templates and all.
 */
export function literalsClosedInComments(source: string): readonly number[] {
  const bad: number[] = []
  // Innermost first. `code` covers both the file's top level and any `${...}`;
  // `depth` counts braces so the closing one of `${...}` can be told from the
  // closing one of an object literal inside it.
  const stack: { kind: 'code' | 'expr' | 'template'; depth: number }[] = [{ kind: 'code', depth: 0 }]
  const frame = (): { kind: 'code' | 'expr' | 'template'; depth: number } =>
    stack[stack.length - 1] ?? { kind: 'code', depth: 0 }

  let index = 0
  let line = 1
  const lineStart = (at: number): boolean => {
    for (let i = at - 1; i >= 0; i -= 1) {
      const ch = source[i]
      if (ch === '\n') return true
      if (ch !== ' ' && ch !== '\t' && ch !== '\r') return false
    }
    return true
  }
  const advance = (by: number): void => {
    for (let i = 0; i < by; i += 1) if (source[index + i] === '\n') line += 1
    index += by
  }

  while (index < source.length) {
    const here = frame()
    const char = source[index] ?? ''
    const next = source[index + 1] ?? ''

    if (here.kind === 'template') {
      if (char === '\\') {
        advance(2)
        continue
      }
      if (char === '`') {
        stack.pop()
        advance(1)
        continue
      }
      if (char === '$' && next === '{') {
        stack.push({ kind: 'expr', depth: 0 })
        advance(2)
        continue
      }
      // A comment in the embedded script. Only at the start of a line -- see
      // the note above about http:// and the 49 false positives.
      if (char === '/' && (next === '/' || next === '*') && lineStart(index)) {
        const block = next === '*'
        const end = block ? source.indexOf('*/', index + 2) : source.indexOf('\n', index + 2)
        const stop = end < 0 ? source.length : end + (block ? 2 : 0)
        const inside = source.slice(index, stop)
        const tick = inside.indexOf('`')
        if (tick >= 0) {
          // The literal closes there, inside a comment. This is the defect.
          advance(tick)
          bad.push(line)
          stack.pop()
          advance(1)
          continue
        }
        advance(stop - index)
        continue
      }
      advance(1)
      continue
    }

    // Real code: the file's top level, or inside a `${...}`.
    if (char === '\\') {
      advance(2)
      continue
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      advance((end < 0 ? source.length : end) - index)
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      advance((end < 0 ? source.length : end + 2) - index)
      continue
    }
    if (char === "'" || char === '"') {
      let at = index + 1
      while (at < source.length && source[at] !== char) at += source[at] === '\\' ? 2 : 1
      advance(Math.min(at + 1, source.length) - index)
      continue
    }
    if (char === '`') {
      stack.push({ kind: 'template', depth: 0 })
      advance(1)
      continue
    }
    if (char === '{' && here.kind === 'expr') here.depth += 1
    else if (char === '}' && here.kind === 'expr') {
      if (here.depth === 0) stack.pop()
      else here.depth -= 1
    }
    advance(1)
  }
  return bad
}

const files = harnesses()

describe('no harness closes a template literal inside a comment', () => {
  it('reads the harnesses, and tells the defect from a quote', () => {
    // The control. Without it a broken walk or a broken scanner reports every
    // file clean by looking at nothing, which is the same green.
    expect(files.length).toBeGreaterThan(50)

    // A comment OUTSIDE a template quoting code in backticks is ordinary and
    // must not be flagged -- these files are full of it.
    expect(literalsClosedInComments('// see `foo` for why\nconst a = 1\n')).toEqual([])
    // Nor is a URL a comment, even though it carries two slashes. The first
    // version of this scanner thought otherwise and went red on 49 files.
    expect(literalsClosedInComments('const u = `http://127.0.0.1/json`\n')).toEqual([])
    // Plain prose inside a template's comment is fine.
    expect(literalsClosedInComments('const s = `a\n// plain words\nb`\n')).toEqual([])
    // THE defect: a line comment inside a template literal carrying a backtick.
    expect(literalsClosedInComments('const s = `a\n// uses `x` here\nb`\n')).toEqual([2])
    // And in a block comment, which is how most of these are written.
    expect(literalsClosedInComments('const s = `a\n/* uses `x`\n here */\nb`\n')).toEqual([2])
    // Inside `${...}` the rules flip back to real code: a comment there is a
    // harness comment, and a backtick in it is only a quote.
    expect(literalsClosedInComments('const s = `a${ /* `q` */ 1 }b`\n')).toEqual([])
  })

  it.each(files.map((path) => path.slice(path.lastIndexOf('\\') + 1)))('%s', (name: string) => {
    const path = files.find((entry) => entry.endsWith(`\\${name}`))
    expect(path).toBeDefined()
    expect(literalsClosedInComments(readFileSync(path ?? '', 'utf8'))).toEqual([])
  })
})
