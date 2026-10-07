// Single-file source mutation controls. Only these files are changed, then restored.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const report = join(root, '.tmp', 'agy-usage-controls.json')
mkdirSync(join(root, '.tmp'), { recursive: true })
const run = (cwd, test) => {
  try {
    execFileSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', test, '--reporter=json', `--outputFile=${report}`],
      { cwd: join(root, cwd), stdio: 'pipe', windowsHide: true, timeout: 120_000 })
  } catch (error) { if (error.status === undefined) throw error }
  const result = JSON.parse(readFileSync(report, 'utf8'))
  return { total: result.numTotalTests, passed: result.numPassedTests,
    failed: result.testResults.flatMap(file => file.assertionResults ?? []).filter(test => test.status === 'failed').map(test => test.title) }
}
const main = 'apps/desktop/src/main/antigravity-usage.ts'
const test = 'src/main/antigravity-usage-is-read-without-a-turn.test.ts'
const controls = [
  { file: main, from: "answer.num_turns !== 0", to: 'false', test, expected: 'ignores a malformed answer or refusal', name: 'a model turn accepted as usage' },
  { file: main, from: "bucket.remaining_fraction === 1 || reset === undefined", to: 'reset === undefined', test, expected: 'does not call a full bucket a future reset', name: 'full-bucket moving reset displayed' },
  { file: main, from: "['5h', 'weekly'].map", to: "['weekly', '5h'].map", test, expected: 'puts the short window first', name: 'window order inverted' },
  { file: main, from: 'other.remaining < gemini.remaining', to: 'false', test, expected: 'puts the short window first', name: 'lower other-model quota omitted' },
  { file: 'apps/desktop/src/main/model-catalog.ts', from: 'const reading = await usage', to: 'await usage\n      const reading = undefined', test, expected: 'keeps the reading and models even when Codex is absent', name: 'Antigravity catalog reading dropped' },
  { file: 'apps/desktop/src/renderer/src/missionView.ts', from: "match[3] === 'left' ? 100 - value : value", to: 'value', test: 'src/renderer/src/antigravity-shows-remaining-not-used.test.tsx', expected: 'uses consumption for bar width', name: 'remaining quota drawn as consumed' },
  { file: 'packages/runtime-adapters/src/cursor-events.ts', from: 'if (isObject(parsed.usage)) usage = sanitizedUsage(parsed.usage);', to: 'usage = undefined;', cwd: 'packages/runtime-adapters', test: 'test/cursor-events.test.ts', expected: 'keeps input, output, cache read and cache write counts from the fixture', name: 'Cursor result tokens dropped' }
]
for (const control of controls) {
  const cwd = control.cwd ?? 'apps/desktop'
  const baseline = run(cwd, control.test)
  if (baseline.total === 0 || baseline.total !== baseline.passed) throw new Error(`Baseline failed: ${control.name}`)
  const path = join(root, control.file)
  const original = readFileSync(path, 'utf8')
  if (original.split(control.from).length !== 2) throw new Error(`Control anchor is not unique: ${control.name}`)
  try {
    writeFileSync(path, original.replace(control.from, control.to))
    const changed = run(cwd, control.test)
    if (changed.total !== baseline.total || !changed.failed.some(title => title.includes(control.expected))) throw new Error(`Control survived: ${control.name}`)
    console.log(`CAUGHT: ${control.name}`)
  } finally { writeFileSync(path, original) }
  const restored = run(cwd, control.test)
  if (restored.passed !== baseline.total) throw new Error(`Restored source failed: ${control.name}`)
}
console.log(`${String(controls.length)} / ${String(controls.length)} controls caught; restored source green`)
