import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every source file in the working tree ends its lines with LF, and only LF.
 *
 * `.gitattributes` pins this for the REPOSITORY, and git's normalisation
 * hides drift from every diff -- which is exactly why nobody sees it. On
 * 2026-09-16 `missionView.ts` and its test had gone CRLF on 2,962 of 3,024
 * lines, and a sweep found nineteen more files the same. Nothing in git
 * said so. What said so was a multi-line anchor failing to match, and the
 * repo already has a memory of that: `mutation-control.mjs` reports a CRLF
 * file as "[SKIP] ... anchor not found", which reads as a stale mutation and
 * is an invariant that has quietly stopped being checked.
 *
 * So the working tree is checked, by bytes, here. A failure names the file;
 * the fix is to strip the CRs, and git will see no change at all.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ROOTS = ['apps/desktop/src', 'packages'] as const
const SOURCE = /\.(ts|tsx|css|mjs|cjs|js|json|md|html|txt)$/
const SKIP = new Set(['node_modules', 'dist', 'out', 'release', '.git'])

function walk(directory: string, into: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, into)
    else if (SOURCE.test(entry)) into.push(path)
  }
}

describe('line endings in the working tree', () => {
  it('are LF in every source file under apps/desktop/src and packages', () => {
    const files: string[] = []
    for (const root of ROOTS) walk(join(ROOT, root), files)
    expect(files.length).toBeGreaterThan(100)
    const carriage = String.fromCharCode(13)
    const drifted = files.filter((file) => readFileSync(file, 'utf8').includes(carriage))
    expect(drifted.map((file) => file.slice(ROOT.length))).toEqual([])
  })
})
