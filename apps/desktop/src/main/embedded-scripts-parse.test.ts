import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { describe, expect, it } from 'vitest'

/**
 * Every browser script a harness sends must parse AS SENT.
 *
 * A drive writes its browser script as a template literal and hands the
 * resulting string to the page. The engine resolves the template's escapes
 * on the way, so the text that runs is not the text in the file -- and the
 * file being valid says nothing about the script being valid.
 *
 * `harness-syntax` checks the file. `harness-backticks` checks one specific
 * way the file lies about where the script ends. Neither one has ever looked
 * at the script itself, and this is the gap they leave.
 *
 * It found two live defects on the day it was written, 2026-09-09, both the
 * same shape and both years-old-looking:
 *
 *   verify-firstrun.mjs  `/[\r\n]+/g` -- the template turned \r and \n into
 *                        a real carriage return and a real newline, and a
 *                        regex literal cannot span lines.
 *   drive-relay.mjs      the same thing written out as a literal tab and
 *                        newline inside a character class.
 *
 * Both were sent to the page, both threw there, and a throw inside
 * `capture()` is recorded as the step's note and walked past -- so they read
 * as the app having nothing to show. The third instance was mine, an hour
 * earlier: an apostrophe escaped once too few, which closed a string.
 *
 * Substitutions are replaced with `(0)` before parsing. The shape of the
 * script is the subject, never the values, and `(0)` takes a member access
 * where a bare `0` would not -- `${census}.phase` is common in these files.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const BACKSLASH = String.fromCharCode(92)

function harnesses(): readonly string[] {
  const found: string[] = []
  for (const directory of ['_tools', '_smoke']) {
    let names: readonly string[]
    try {
      names = readdirSync(join(ROOT, directory))
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(ROOT, directory, name)
      if (name.endsWith('.mjs') && statSync(path).isFile()) found.push(path)
    }
  }
  return found.sort()
}

/**
 * The scripts one harness hands to the page, as the page receives them.
 *
 * Each `evaluate(` followed by a template literal, read to its matching
 * close -- `${...}` is tracked so a backtick inside a substitution does not
 * end the literal early -- then built through the engine so the escapes are
 * resolved exactly as they would be at run time.
 */
export function embeddedScripts(source: string): readonly string[] {
  const scripts: string[] = []
  for (const match of source.matchAll(/evaluate\(\s*`/g)) {
    const from = (match.index ?? 0) + match[0].length
    let index = from
    let depth = 0
    let end = -1
    while (index < source.length) {
      const char = source[index]
      if (char === BACKSLASH) {
        index += 2
        continue
      }
      if (char === '$' && source[index + 1] === '{') {
        depth += 1
        index += 2
        continue
      }
      if (char === '}' && depth > 0) {
        depth -= 1
        index += 1
        continue
      }
      if (char === '`' && depth === 0) {
        end = index
        break
      }
      index += 1
    }
    if (end < 0) continue
    const withPlaceholders = source.slice(from, end).replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '(0)')
    // Builds the string, runs nothing.
    scripts.push(new Function(`return \`${withPlaceholders}\``)() as string)
  }
  return scripts
}

/**
 * The RAW template text of each embedded script, before the engine eats it.
 *
 * `embeddedScripts` returns what the page receives. This returns what the
 * author typed, which is where the escape mistake is visible: by the time
 * the template has been resolved, a mangled `\s` is just the letter `s` and
 * there is nothing left to find.
 */
export function embeddedSources(source: string): readonly string[] {
  const raw: string[] = []
  for (const match of source.matchAll(/evaluate\(\s*`/g)) {
    const from = (match.index ?? 0) + match[0].length
    let index = from
    let depth = 0
    let end = -1
    while (index < source.length) {
      const char = source[index]
      if (char === BACKSLASH) {
        index += 2
        continue
      }
      if (char === '$' && source[index + 1] === '{') {
        depth += 1
        index += 2
        continue
      }
      if (char === '}' && depth > 0) {
        depth -= 1
        index += 1
        continue
      }
      if (char === '`' && depth === 0) {
        end = index
        break
      }
      index += 1
    }
    if (end >= 0) raw.push(source.slice(from, end))
  }
  return raw
}

/**
 * Single backslashes the template will swallow, with the line they are on.
 *
 * `\s` inside a template literal is not an escape the language knows, so it
 * resolves to the bare letter `s` -- and `/\s+/g` becomes `/s+/g`, a regex
 * that deletes every letter s in the text. It is silent: the harness parses,
 * the emitted script parses, and the only symptom is output with letters
 * missing from it.
 *
 * It has cost this session TEN separate times, including twice while writing
 * the controls meant to stop it. `\b` is worse -- that one resolves to a
 * BACKSPACE character.
 *
 * Only the letters that mean nothing as a string escape, so a deliberate
 * `\n` for a real newline is left alone.
 */
export function swallowedEscapes(raw: string): readonly number[] {
  const found: number[] = []
  let line = 1
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === String.fromCharCode(10)) line += 1
    if (raw[i] !== BACKSLASH) continue
    // A doubled backslash is the author being correct; step over both.
    if (raw[i + 1] === BACKSLASH) {
      i += 1
      continue
    }
    if (/[sdwSDWb]/.test(raw[i + 1] ?? '')) found.push(line)
  }
  return found
}

const files = harnesses()
const total = files.reduce((count, path) => count + embeddedScripts(readFileSync(path, 'utf8')).length, 0)

describe('the browser scripts the harnesses send', () => {
  it('are found, and a broken one is really caught', () => {
    // The control. A walk that finds nothing, or an extractor that returns
    // nothing, reports every harness clean by looking at no scripts.
    expect(files.length).toBeGreaterThan(50)
    expect(total).toBeGreaterThan(300)

    // THE defect, in the two shapes it has actually taken. Both files are
    // valid JavaScript; only the emitted script is not.
    const newlineInRegex = `x.replace(/[${BACKSLASH}r${BACKSLASH}n]+/g, ' ')`
    expect(() => new vm.Script(embeddedScripts(`evaluate(\`${newlineInRegex}\`)`)[0] ?? '')).toThrow()
    const shortEscape = `return 'no one else${BACKSLASH}'s'`
    expect(() => new vm.Script(embeddedScripts(`evaluate(\`${shortEscape}\`)`)[0] ?? '')).toThrow()

    // And the fixed forms of both must NOT throw, or this would pass by
    // objecting to everything.
    const doubled = `x.replace(/[${BACKSLASH}${BACKSLASH}r${BACKSLASH}${BACKSLASH}n]+/g, ' ')`
    expect(() => new vm.Script(embeddedScripts(`evaluate(\`${doubled}\`)`)[0] ?? '')).not.toThrow()
  })

  it.each(files.map((path) => path.slice(path.lastIndexOf('\\') + 1)))('%s', (name: string) => {
    const path = files.find((entry) => entry.endsWith(`${BACKSLASH}${name}`))
    expect(path).toBeDefined()
    const source = readFileSync(path ?? '', 'utf8')
    for (const script of embeddedScripts(source)) {
      expect(
        () => new vm.Script(script),
        `this is sent to the page as written: ${script.replace(/\s+/g, ' ').slice(0, 120)}`
      ).not.toThrow()
    }
    for (const raw of embeddedSources(source)) {
      expect(
        swallowedEscapes(raw),
        `a single backslash the template will swallow -- \s becomes the letter s, and /\s+/g becomes /s+/g`
      ).toEqual([])
    }
  })
})
