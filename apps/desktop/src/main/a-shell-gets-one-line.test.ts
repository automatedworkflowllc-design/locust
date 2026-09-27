import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A SHELL IS HANDED ONE LINE (0.381).
 *
 * `spawn(command, [args...], { shell: true })` has Node join the array into
 * the shell's command line unescaped, and Node has deprecated it (DEP0190):
 * the warning was in the log of every packaged launch -- 475 drive records
 * -- and a later Node may refuse it outright, which would take the npm probe
 * and the runtime installer with it. Found by the Windows security-software
 * audit (docs/AUDIT-2026-09-26-WINDOWS-SECURITY-SOFTWARE.md), after Orca's
 * notes on what gets a desktop app flagged.
 *
 * So wherever the host starts a shell, it hands it one string, built from
 * tokens it has checked. A spawn with `shell: true` and an argument array
 * is refused here, in every main-process file.
 */
const MAIN = fileURLToPath(new URL('./', import.meta.url))

describe('a shell is handed one line', () => {
  it('no spawn in the host passes an argument array beside shell: true', () => {
    const offenders: string[] = []
    for (const name of readdirSync(MAIN)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
      const source = readFileSync(`${MAIN}${name}`, 'utf8')
      // Each spawn call, up to its options: an array literal as the second
      // argument, then `shell: true` in the same call.
      for (const match of source.matchAll(/spawn\(\s*[^,()]+,\s*\[[^\]]*\]\s*,\s*\{[^}]*shell:\s*true/g)) {
        offenders.push(`${name}: ${match[0].slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the three that start npm each pass one command string', () => {
    const read = (name: string): string => readFileSync(`${MAIN}${name}`, 'utf8')
    expect(read('index.ts')).toContain("spawn('npm --version', { shell: true")
    expect(read('npm-prefix.ts')).toContain("spawn('npm config get prefix', {")
    expect(read('runtime-installer.ts')).toContain("spawn([command, ...args].join(' '), { shell: true")
  })
})
