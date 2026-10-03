// Breaks the scrub, runs the unit test, and requires the named sentence to
// fail. Restores the source before exiting, including when the test run throws.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const target = join(dir, 'public-export.mjs')
const sentence = 'a windows user path is rewritten so the folder name is home'
const needle = "  return text.replace(accountPattern(), '<home>')"
const original = readFileSync(target, 'utf8')
const broken = original.replace(needle, '  return text')
if (broken === original || !original.includes(needle)) {
  console.error('anchor not found; the scrub was not broken')
  process.exit(1)
}

writeFileSync(target, broken)
let failedNamed = false
try {
  const result = spawnSync(process.execPath, ['--test', join(dir, 'public-export.test.mjs')], { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  failedNamed = result.status !== 0 && output.includes(sentence) && /not ok|fail/i.test(output)
  if (!failedNamed) {
    console.error('the broken scrub did not fail the named test')
    console.error(output)
    process.exitCode = 1
  } else {
    console.log(`Observed: "${sentence}" failed while the rewrite was removed.`)
    for (const line of output.split('\n')) {
      if (/not ok|AssertionError|rewritten|Expected|Actual|location:/.test(line)) console.log(line)
    }
  }
} finally {
  writeFileSync(target, original)
}

if (readFileSync(target, 'utf8') !== original) {
  console.error('restore failed')
  process.exitCode = 1
} else if (failedNamed) {
  console.log('Restored the scrub.')
}
