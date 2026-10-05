// Real source controls, not a parser-only example. Every file is restored in finally.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
const scratch = join(root, '.tmp/home-idle-controls')
mkdirSync(scratch, { recursive: true })
const report = join(scratch, 'result.json')
const tests = ['src/renderer/src/the-home-cover-rests-after-inactivity.test.ts', 'src/main/the-home-keyframes-only-transform-and-fade.test.ts']
const run = () => {
  rmSync(report, { force: true })
  try {
    execFileSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...tests, '--reporter=json', `--outputFile=${report}`], { cwd: desktop, stdio: 'pipe', timeout: 120_000 })
  } catch (error) { if (error.status === undefined) throw error }
  const result = JSON.parse(readFileSync(report, 'utf8'))
  return { total: result.numTotalTests, passed: result.numPassedTests,
    failed: result.testResults.flatMap((file) => file.assertionResults ?? []).filter((test) => test.status === 'failed').map((test) => test.title) }
}
const mutations = [
  { file: 'apps/desktop/src/renderer/src/useCoverActivity.ts', from: 'left <= 0', to: 'false', name: 'Idle pause omitted', expected: 'pauses at 45 seconds, with no polling or timers left while resting' },
  { file: 'apps/desktop/src/renderer/src/shell.css', from: '@keyframes lcBotFloat {', to: '@keyframes lcBotFloat {\n  3% { top: 1px; }', name: 'Float animates layout', expected: 'every keyframe used by the cover and bots only transforms or fades' }
]
const baseline = run()
if (baseline.failed.length || baseline.passed !== baseline.total || baseline.total === 0) throw new Error(`Baseline not green: ${JSON.stringify(baseline)}`)
console.log(`Baseline: ${baseline.total} passed`)
for (const mutation of mutations) {
  const file = join(root, mutation.file)
  const original = readFileSync(file, 'utf8')
  if (original.split(mutation.from).length !== 2) throw new Error(`Control anchor is not unique: ${mutation.name}`)
  try {
    writeFileSync(file, original.replace(mutation.from, mutation.to))
    const result = run()
    if (result.total !== baseline.total || !result.failed.includes(mutation.expected)) throw new Error(`Control survived or did not execute: ${mutation.name}: ${JSON.stringify(result)}`)
    console.log(`CAUGHT: ${mutation.name} by ${mutation.expected}`)
  } finally { writeFileSync(file, original) }
}
const restored = run()
if (restored.passed !== baseline.total) throw new Error('Restored source is not green')
console.log(`Restored: ${restored.total} passed; both controls caught`)
