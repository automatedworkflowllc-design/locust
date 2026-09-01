// Mutation control for the renderer's status derivations.
//
// These functions decide whether the shell may call a runtime live, whether a
// teammate reads as blocked, and whether a receipt prints `verified`. The
// product's entire claim is that those words are trustworthy, so a green suite
// over them is not enough -- each invariant must be shown to fail when broken.
//
//   node test/mutation-control.mjs
//
// Breaks one behaviour at a time, requires the NAMED test to fail, rejects any
// mutation that stops the file running, and restores every file it touches.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STATUS = join(ROOT, 'src', 'renderer', 'src', 'status.ts')

const MUTATIONS = [
  {
    name: 'a stale ready flag alone is enough to call a runtime usable',
    from: '  return runtime.ready && runtime.status === \'ready\'',
    to: '  return runtime.ready',
    expect: 'never issues ACTIVE or READY for a runtime that is not ready'
  },
  {
    name: 'a ready probe alone is enough, ignoring the readiness flag',
    from: '  return runtime.ready && runtime.status === \'ready\'',
    to: '  return runtime.status === \'ready\'',
    expect: 'never issues ACTIVE or READY for a runtime that is not ready'
  },
  {
    name: 'a half-built adapter is advertised as ready',
    from: '      tag: \'PREVIEW\',',
    to: '      tag: \'READY\',',
    expect: 'never calls a half-built adapter live, even when its runtime is ready'
  },
  {
    name: 'a planned runtime becomes selectable',
    from: '      tag: \'PLANNED\',\n      selectable: false,',
    to: '      tag: \'PLANNED\',\n      selectable: true,',
    expect: 'keeps a planned runtime non-interactive whatever discovery says'
  },
  {
    name: 'every discovered runtime counts as connected',
    from: '  return runtimes.filter(runtimeIsUsable).length',
    to: '  return runtimes.length',
    expect: 'counts only usable runtimes as connected'
  },
  {
    name: 'a blocked runtime is hidden behind an optimistic running mission',
    from: '  if (input.runtime === undefined || !runtimeIsUsable(input.runtime)) {',
    to: '  if (false) {',
    expect: 'reports a blocked runtime even while a mission looks like it is running'
  },
  {
    name: 'a completed mission prints clean over an unreadable ledger',
    from: '  if (hasIntegrityIssues) {',
    to: '  if (false) {',
    expect: 'will not present a completed mission as clean when its ledger is not'
  },
  {
    name: 'the receipt says verified regardless of integrity issues',
    from: '  return integrityIssueCount === 0 ? \'verified\' : \'incomplete\'',
    to: '  return \'verified\'',
    expect: 'will not present a completed mission as clean when its ledger is not'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report first: a run that dies before writing one would otherwise
  // leave the previous report in place and read as "this mutation broke
  // nothing" -- a check that cannot go red, inside the tool that exists to
  // prove checks can.
  rmSync(REPORT, { force: true })
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter', 'json', '--outputFile', 'mutation-result.json'], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: true
    })
  } catch {
    // A red suite exits non-zero; the report is what we read, not the status.
  }
  if (!existsSync(REPORT)) return { failed: [], unparseable: true, total: -1 }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'))
  const failed = []
  let unparseable = false
  for (const file of report.testResults ?? []) {
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) unparseable = true
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'failed') failed.push(assertion.title)
    }
  }
  return { failed, unparseable, total: report.numTotalTests ?? 0 }
}

const original = readFileSync(STATUS, 'utf8')
let problems = 0

try {
  const baseline = runSuite()
  if (baseline.failed.length > 0) {
    console.error(`baseline is not green: ${baseline.failed.join(', ')}`)
    process.exit(1)
  }
  console.error(`baseline green (${baseline.total} tests)\n`)

  for (const mutation of MUTATIONS) {
    if (!original.includes(mutation.from)) {
      console.error(`  [SKIP] ${mutation.name} -- anchor not found`)
      problems += 1
      continue
    }
    writeFileSync(STATUS, original.replace(mutation.from, mutation.to), 'utf8')
    const result = runSuite()
    writeFileSync(STATUS, original, 'utf8')

    if (result.unparseable || result.total !== baseline.total) {
      console.error(`  [INVALID] ${mutation.name} -- the file stopped running, so this red means nothing`)
      problems += 1
      continue
    }
    const caught = result.failed.includes(mutation.expect)
    if (!caught) problems += 1
    console.error(
      `  [${caught ? 'CAUGHT' : 'SURVIVED'}] ${mutation.name}` +
        (caught ? '' : `\n            expected "${mutation.expect}" to fail; failures: ${result.failed.join(', ') || 'none'}`)
    )
  }
} finally {
  writeFileSync(STATUS, original, 'utf8')
  rmSync(REPORT, { force: true })
}

console.error(`\n${problems === 0 ? 'ALL MUTATIONS CAUGHT' : `${problems} MUTATION(S) UNACCOUNTED FOR`}`)
process.exit(problems === 0 ? 0 : 1)
