import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A doubled backslash that became a single one, in SHIPPING source.
 *
 * `no-stray-control-characters` catches a shell that wrote a real control
 * character. `embedded-scripts-parse` catches an escape a template literal
 * swallowed, in the harnesses. Neither looks at this, and this is where it
 * cost the most on 2026-09-10:
 *
 *   CliArtifacts.tsx   `split` on a class holding BOTH separators was written through a heredoc and
 *                      arrived as a class holding only the forward one. Valid TypeScript, valid
 *                      regex, and it never split a Windows path again -- so
 *                      every artifact row rendered a full a full Windows path
 *                      instead of its last two segments. Caught only because
 *                      a test happened to use a Windows fixture.
 *
 * An escaped forward slash in a class is the tell, and it is unambiguous: a forward slash inside a
 * character class needs no escape at all, so nobody escapes one on purpose.
 * It is always the residue of the doubled form -- the class that means "either
 * separator" -- with one backslash eaten on the way in.
 *
 * SIX swallowed escapes in one session, two of them reaching shipping source.
 * The rule was known every time, which is how you know a rule is not a
 * control.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
// `docs` holds no source, only drive records (20,864 files on 2026-10-02): walking them
// timed this test out under the full suite.
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'release', 'user-session', 'docs'])
const SOURCE = ['.ts', '.tsx', '.mjs']
const BACKSLASH = String.fromCharCode(92)

function sources(): readonly string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    let names: readonly string[]
    try {
      names = readdirSync(directory)
    } catch {
      return
    }
    for (const name of names) {
      if (SKIP.has(name)) continue
      const path = join(directory, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (SOURCE.some((extension) => name.endsWith(extension))) found.push(path)
    }
  }
  walk(ROOT)
  return found.sort()
}

/**
 * Character classes holding an escaped forward slash, which nobody means.
 *
 * Only inside `[...]`: outside a class, `\/` is how a literal slash is
 * written in a regex and is perfectly ordinary.
 */
export function escapedSlashInClass(source: string): readonly string[] {
  const found: string[] = []
  // Scanned rather than matched. A regex that looks for a regex has to escape
  // its own brackets and backslashes twice over, which is the very mistake
  // this file exists to catch -- the first version of it was wrong in exactly
  // that way.
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '[') continue
    const close = source.indexOf(']', index + 1)
    if (close < 0) break
    const inside = source.slice(index + 1, close)
    // An ARRAY literal is not a character class, and `runtime-setup.ts` has
    // one holding two `replace` calls that between them mention both
    // separators. A regex class never contains a space or a comma; an array of
    // expressions almost always does.
    if (/[\s,]/.test(inside)) {
      index = close
      continue
    }
    for (let at = 0; at < inside.length; at += 1) {
      if (inside[at] !== BACKSLASH) continue
      // A doubled backslash is the author being right; step over both.
      if (inside[at + 1] === BACKSLASH) {
        at += 1
        continue
      }
      if (inside[at + 1] === '/') {
        found.push(`[${inside}]`)
        break
      }
    }
    index = close
  }
  return found
}

describe('escapes that survived the shell', () => {
  it('finds files, and would really catch the defect', () => {
    // The control. A walk that finds nothing reports every file clean.
    expect(sources().length).toBeGreaterThan(200)

    // THE defect, in the shape it took in CliArtifacts.tsx.
    expect(escapedSlashInClass('path.split(/[' + BACKSLASH + '/]/)')).toHaveLength(1)
    // And the correct form must NOT be reported, or this passes by objecting
    // to everything.
    expect(escapedSlashInClass('path.split(/[' + BACKSLASH + BACKSLASH + '/]/)')).toEqual([])
    // Nor an escaped slash outside a class, which is ordinary.
    expect(escapedSlashInClass('/https:' + BACKSLASH + '/' + BACKSLASH + '/example/')).toEqual([])
  })

  it('are intact in every tracked source file', () => {
    const bad: string[] = []
    for (const path of sources()) {
      for (const found of escapedSlashInClass(readFileSync(path, 'utf8'))) {
        bad.push(`${path.slice(ROOT.length)}: ${found}`)
      }
    }
    expect(
      bad,
      'a forward slash inside a character class needs no escape, so this is a doubled backslash the shell ate'
    ).toEqual([])
  })
})
