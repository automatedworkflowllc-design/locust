// Deliberately break each verdict and require its named test to catch it.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, '_tools/free-model-scorecard.mjs')
const original = readFileSync(source, 'utf8')
const scratch = mkdtempSync(join(process.env.LOCUST_GATE_TMP ?? tmpdir(), 'scorecard-controls-'))
const report = join(scratch, 'results.json')
const testFile = '_tools/free-model-scorecard.test.mjs'
function suite() {
  rmSync(report, { force: true })
  const run = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', testFile, '--reporter=json', '--outputFile', report], { cwd: root, encoding: 'utf8' })
  if (!run.stdout && !run.stderr) throw new Error('Test runner did not start')
  const result = JSON.parse(readFileSync(report, 'utf8'))
  return { total: result.numTotalTests, failed: result.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'failed').map(test => test.title)) }
}
const mutations = [
  ["state = 'rate-limited'", "state = 'failing'", 'a recorded provider limit is rate-limited with its words and detection time'],
  ['if (runRes.timedOut) return', 'if (false) return', 'a plain timeout remains failing and a verified pass remains good'],
  ["state = 'good'", "state = 'failing'", 'a plain timeout remains failing and a verified pass remains good'],
  ['limitedStatus = event.error?.data?.statusCode === 429', 'limitedStatus = false', 'only provider errors count as limits, including JSON quota errors'],
  ['rateLimit = providerLimitFromLine(line, source)', 'rateLimit = undefined', 'a split live limit stops the job before its timeout and waits for close']
]
try {
  const baseline = suite()
  if (baseline.total !== 10 || baseline.failed.length) throw new Error(`Baseline is not green: ${JSON.stringify(baseline)}`)
  for (const [from, to, named] of mutations) {
    if (!original.includes(from)) throw new Error(`Missing mutation anchor: ${from}`)
    try {
      writeFileSync(source, original.replace(from, to))
      const result = suite()
      if (result.total !== baseline.total || !result.failed.includes(named)) throw new Error(`Control not caught by ${named}: ${JSON.stringify(result)}`)
      console.log(`CAUGHT: ${named}`)
    } finally {
      writeFileSync(source, original)
    }
  }
  const restored = suite()
  if (restored.total !== 10 || restored.failed.length) throw new Error(`Restored suite is not green: ${JSON.stringify(restored)}`)
  console.log('All 5 controls caught; source restored; 10 tests passed again')
} finally {
  writeFileSync(source, original)
  rmSync(scratch, { recursive: true, force: true })
}
