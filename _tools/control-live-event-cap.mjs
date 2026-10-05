import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const desktop = join(root, 'apps/desktop')
mkdirSync(join(root, '.tmp'), { recursive: true })
const report = join(root, '.tmp/live-event-controls.json')
const tests = ['src/renderer/src/a-long-turn-keeps-what-it-said.test.ts', 'src/renderer/src/a-trimmed-live-turn-says-so-on-screen.test.tsx']
function suite() {
  rmSync(report, { force: true })
  try { execFileSync('npx', ['vitest', 'run', ...tests, '--reporter=json', '--outputFile', report], { cwd: desktop, shell: true, stdio: 'pipe' }) } catch { /* Require the named assertion below, not just a failing exit. */ }
  const result = JSON.parse(readFileSync(report, 'utf8'))
  return { total: result.numTotalTests, failed: result.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'failed').map(test => test.title)) }
}
const baseline = suite()
if (baseline.total !== 9 || baseline.failed.length) throw new Error(`baseline is not green: ${JSON.stringify(baseline)}`)
console.log('Baseline: 9 passed')
const mutations = [
  ['apps/desktop/src/shared/event-window.ts', 'EVENT_WINDOW = 3_000', 'EVENT_WINDOW = 500', 'keeps both messages in a running turn of that length'],
  ['apps/desktop/src/shared/event-window.ts', 'Math.max(1, Math.floor(cap / 4))', '1', 'keeps its opening messages and newest live step after repeated evictions'],
  ['apps/desktop/src/renderer/src/liveEvents.ts', '() => { eventsTruncated = true }', '() => { eventsTruncated = false }', 'shows the omission notice once when a running turn exceeds 3000 events'],
  ['apps/desktop/src/renderer/src/components/Thread.tsx', 'restoredMission?.eventsTruncated === true || eventsTruncated === true', 'true', 'shows no omission notice below or exactly at 3000 events']
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
console.log('All 4 controls caught; sources restored; 9 tests passed again')
