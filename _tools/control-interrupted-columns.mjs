import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
const report = join(root, '.tmp/interrupted-controls.json')
const renderer = 'src/renderer/src/a-reload-keeps-every-comparison-column-live.test.ts'
const host = 'src/main/a-history-read-names-the-processes-still-owned.test.ts'
function suite() {
  rmSync(report, { force: true })
  try { execFileSync('npx', ['vitest', 'run', renderer, host, '--reporter=json', '--outputFile', report], { cwd: desktop, shell: true, stdio: 'pipe' }) } catch { /* Read assertions, not an exit alone. */ }
  const result = JSON.parse(readFileSync(report, 'utf8'))
  const failed = result.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'failed').map(test => test.title))
  return { total: result.numTotalTests, failed }
}
const mutations = [
  ['apps/desktop/src/renderer/src/recoverLiveRuns.ts', "phase: 'running', restored: false", "phase: 'interrupted', restored: true", 'restores both silent host-owned columns as running without an interrupted error'],
  ['apps/desktop/src/renderer/src/recoverLiveRuns.ts', 'for (const update of queued) run = apply(run, update)', 'for (const update of []) run = apply(run, update)', 'replays the recorded completion that arrived before history named its run'],
  ['apps/desktop/src/renderer/src/recoverLiveRuns.ts', 'if (held.has(mission.runId)) continue', 'if (false) continue', 'keeps an already-held terminal receipt ahead of an older live history answer'],
  ['apps/desktop/src/main/mission-history.ts', 'liveMissionIds: [...new Set(liveMissionIds)]', 'liveMissionIds: []', 'includes every transport and sends unique live ids without changing ledger phases'],
  ['apps/desktop/src/renderer/src/App.tsx', 'current, response.data.missions, response.data.liveMissionIds ?? [], pendingUpdatesRef.current,', 'current, [], response.data.liveMissionIds ?? [], pendingUpdatesRef.current,', 'connects every history read and late known-run update to reload recovery']
]
const baseline = suite()
if (baseline.total !== 8 || baseline.failed.length) throw new Error(`baseline is not green: ${JSON.stringify(baseline)}`)
console.log('Baseline: 8 passed')
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
const waiter = join(root, '_tools/compare-terminal-wait.mjs'), original = readFileSync(waiter, 'utf8')
for (const [from, to, named] of [
  ['last.columns.every(column => column.terminal || column.refused)', 'last.columns.some(column => column.terminal || column.refused)', 'one terminal column never ends the wait for the other'],
  ['if (shownTerminal && last.columns.length', 'if (last.columns.length', 'terminal receipts wait for the screen to display the last completed column']
]) {
 try {
  if (!original.includes(from)) throw new Error('missing wait anchor')
  writeFileSync(waiter, original.replace(from, to))
  let output = ''
  try { execFileSync(process.execPath, ['--test', '_tools/compare-terminal-wait.test.mjs'], { cwd: root, stdio: 'pipe' }) }
  catch (error) { output = String(error.stdout) }
  if (!output.includes(`✖ ${named}`) || !output.includes('ℹ tests 6')) throw new Error(`wait control did not fail its named test: ${output}`)
  console.log(`CAUGHT: ${named} (6 tests still ran)`)
} finally { writeFileSync(waiter, original) }
}
rmSync(report, { force: true })
console.log('All 7 controls caught; sources restored')
