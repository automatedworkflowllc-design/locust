import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
mkdirSync(join(root, '.tmp'), { recursive: true })
const report = join(root, '.tmp/first-launch-controls.json')
const tests = ['src/renderer/src/a-teammate-is-not-stuck-while-agents-are-still-being-found.test.ts']
function suite() {
  rmSync(report, { force: true })
  try { execFileSync('npx', ['vitest', 'run', ...tests, '--reporter=json', '--outputFile', report], { cwd: desktop, shell: true, stdio: 'pipe' }) } catch { /* Require the named assertion below, not just a failing exit. */ }
  const result = JSON.parse(readFileSync(report, 'utf8'))
  return { total: result.numTotalTests, failed: result.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'failed').map(test => test.title)) }
}
const baseline = suite()
if (baseline.total !== 7 || baseline.failed.length) throw new Error(`baseline is not green: ${JSON.stringify(baseline)}`)
console.log('Baseline: 7 passed')
const mutations = [
  ['apps/desktop/src/renderer/src/status.ts', 'usable || !pending', 'true', 'has no global blocked verdict while the only possible agent is still checking'],
  ['apps/desktop/src/renderer/src/status.ts', 'input.runtime.checking !== true &&', '', 'keeps its pending own agent idle even when another agent is ready'],
  ['apps/desktop/src/renderer/src/status.ts', 'input.runtime.checking !== true &&', 'false &&', 'keeps a checked unusable own agent blocked while another check is pending'],
  ['apps/desktop/src/renderer/src/status.ts', "return runtime.ready && runtime.status === 'ready'", 'return false', 'returns to idle when a late ready answer replaces a checked failure']
]

for (const [path, from, to, named] of mutations) {
  const file = join(root, path), original = readFileSync(file, 'utf8')
  if (!original.includes(from)) throw new Error(`missing anchor: ${path}`)
  try {
    writeFileSync(file, original.replace(from, to))
    const result = suite()
    if (result.total !== baseline.total || !result.failed.includes(named)) throw new Error(`not caught by ${named}: ${JSON.stringify(result)}`)
    console.log(`CAUGHT: ${named}`)
  } finally { writeFileSync(file, original) }
}
const restored = suite()
if (restored.total !== baseline.total || restored.failed.length) throw new Error(`restored suite is not green: ${JSON.stringify(restored)}`)
rmSync(report, { force: true })
console.log('All 4 controls caught; sources restored; 7 tests passed again')
