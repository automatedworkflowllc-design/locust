import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * No harness may select something this app cannot draw.
 *
 * A drive that queries a class the renderer no longer produces gets back
 * nothing — and nothing is exactly what a missing feature looks like. So the
 * app changes, a drive keeps passing or keeps reporting an absence, and the
 * lie survives until someone spends an afternoon on it.
 *
 * That has happened three times in this repo. Drives guarded on an `is-open`
 * class `ActivityCard` has never set, so the guard was always true. A drive
 * read the user's message bubble as `.lc-msg, .lc-turn, [class*="user"]`,
 * matched nothing, printed `[]`, and a screenshot happened to cover for it.
 * `verify-firstrun` counted runtime rows with three selectors that between
 * them matched none, and printed `runtime rows: []` as if that were an answer.
 *
 * The rule here is narrow on purpose: a `querySelector` string is a failure
 * only when it names at least one `lc-` class and NONE of the classes in it
 * exist. A selector with one live branch is fine — that is what a fallback
 * chain is for — and a selector with no `lc-` class at all is not this test's
 * business.
 *
 * Only `lc-` classes are checked. `aria-label` selectors rot the same way (a
 * changed avatar title once broke 68 of them at once) but those are prose,
 * and matching them here would produce false alarms this test could not
 * defend. Named rather than quietly skipped.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SRC = join(ROOT, 'apps', 'desktop', 'src')

/**
 * Selectors that match nothing ON PURPOSE.
 *
 * An assertion that something is ABSENT has to name it to look for it, so
 * "matches nothing" is its passing state. Each entry needs a reason.
 */
const ABSENCE_ASSERTIONS: readonly { readonly file: string; readonly selector: string; readonly why: string }[] = [
  {
    file: 'avatar-smoke.mjs',
    selector: 'progress, [role="progressbar"], .lc-progress',
    why: 'asserts "no progress bar exists anywhere" — matching nothing is the pass'
  }
]

function readAll(directory: string, endings: readonly string[]): string[] {
  const out: string[] = []
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (endings.some((end) => name.endsWith(end)) && !name.includes('.test.')) {
        out.push(readFileSync(path, 'utf8'))
      }
    }
  }
  walk(directory)
  return out
}

const appClasses = new Set(
  readAll(SRC, ['.tsx', '.ts', '.css']).flatMap((text) => text.match(/lc-[a-zA-Z0-9_-]+/g) ?? [])
)

const CALL = /querySelectorAll?\(\s*(['"`])(.*?)\1/gs

function deadSelectors(text: string, file: string): string[] {
  const dead: string[] = []
  for (const [, , selector] of text.matchAll(CALL)) {
    const classes = selector.match(/lc-[a-zA-Z0-9_-]+/g) ?? []
    if (classes.length === 0) continue
    if (classes.some((name) => appClasses.has(name))) continue
    const trimmed = selector.trim()
    if (ABSENCE_ASSERTIONS.some((entry) => entry.file === file && entry.selector === trimmed)) continue
    dead.push(trimmed)
  }
  return dead
}

const harnesses = ['_tools', '_smoke'].flatMap((folder) => {
  const at = join(ROOT, folder)
  return readdirSync(at)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => ({ name, text: readFileSync(join(at, name), 'utf8') }))
})

describe('no harness selects something the app cannot draw', () => {
  it('found the app classes and the harnesses at all', () => {
    // Without this, a wrong path makes every case below vacuously green: no
    // classes known would flag everything, no harnesses found would flag
    // nothing.
    expect(appClasses.size).toBeGreaterThan(200)
    expect(harnesses.length).toBeGreaterThan(20)
    expect(appClasses.has('lc-bubble')).toBe(true)
  })

  it.each(harnesses.map((entry) => entry.name))('%s', (name: string) => {
    const found = harnesses.find((entry) => entry.name === name)
    expect(deadSelectors(found?.text ?? '', name)).toEqual([])
  })
})
