// Mutation control for the checkpoint suite.
//
// A passing suite is only evidence if it could have failed. This breaks one
// behaviour at a time in the engine, runs the suite, and requires the EXPECTED
// test to fail -- not merely that something failed, because a mutation that
// makes the file unparseable fails everything while verifying nothing.
//
//   node test/mutation-control.mjs
//
// Restores every file it touches, including on error. Exits non-zero if any
// mutation survives, or if a mutation fails for the wrong reason.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CHECKPOINT = join(ROOT, 'src', 'checkpoint.ts')
const INDEX = join(ROOT, 'src', 'index.ts')

const MUTATIONS = [
  {
    name: 'an action that never reported an outcome is dropped from the record',
    file: CHECKPOINT,
    from: '  const unsettledActions = [...open.values()]',
    to: '  const unsettledActions = ([] as UnsettledAction[])',
    expect: 'refuses to call a mission safe while an action never reported an outcome'
  },
  {
    name: 'an action that reported an outcome is not recorded as settled',
    file: CHECKPOINT,
    from: '    settled.add(event.payload.itemId)',
    to: '    void event.payload.itemId',
    expect: 'reports a settled mission as safe to resume elsewhere'
  },
  {
    name: 'a checkpoint may claim safety while listing an unknown action',
    file: CHECKPOINT,
    from: '  if (value.resumeSafety === \'safe\' && value.unsettledActions.length > 0) return undefined',
    to: '  void 0',
    expect: 'refuses a checkpoint that claims safety while listing an unknown action'
  },
  {
    name: 'the summary keeps only the last delta fragment',
    file: CHECKPOINT,
    from: '    const next = operation === \'replace\' ? text : `${buffers.get(itemId) ?? \'\'}${text}`',
    to: '    const next = text',
    expect: 'rebuilds an appended message rather than keeping only its last fragment'
  },
  {
    name: 'every transcript hashes the same',
    file: CHECKPOINT,
    from: '    hash.update(',
    to: '    void event; hash.update(',
    to2: '`${event.sequence}${SEP}${event.id}${SEP}${event.type}${SEP}`',
    replacement2: '\'constant\'',
    expect: 'gives different transcripts different digests'
  },
  {
    name: 'the digest drops its field separator',
    file: CHECKPOINT,
    from: '${event.sequence}${SEP}${event.id}${SEP}${event.type}${SEP}',
    to: '${event.sequence}${event.id}${event.type}',
    expect: 'gives different transcripts different digests'
  },
  {
    name: 'a damaged ledger is checkpointed anyway',
    file: INDEX,
    from: '        if (checkpoint.resumeSafety === \'unsafe\') return checkpoint',
    to: '        void 0',
    expect: 'reports an unreadable ledger as unsafe, and refuses to write past the break'
  },
  {
    name: 'recovery accepts an out-of-order checkpoint epoch',
    file: INDEX,
    from: '        || checkpoint.epoch !== checkpoints.length + 1\n',
    to: '',
    expect: 'stops recovery at a checkpoint whose epoch is out of order'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report FIRST. A vitest run that dies before writing one would
  // otherwise leave the previous run's report in place, and the harness would
  // read a stale green as "this mutation caused no failures" -- a check that
  // cannot go red, inside the tool whose whole job is proving checks can.
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

const originals = new Map([
  [CHECKPOINT, readFileSync(CHECKPOINT, 'utf8')],
  [INDEX, readFileSync(INDEX, 'utf8')]
])

let problems = 0
try {
  const baseline = runSuite()
  if (baseline.failed.length > 0) {
    console.error(`baseline is not green: ${baseline.failed.join(', ')}`)
    process.exit(1)
  }
  console.error(`baseline green (${baseline.total} tests)\n`)

  for (const mutation of MUTATIONS) {
    const original = originals.get(mutation.file)
    if (!original.includes(mutation.from)) {
      console.error(`  [SKIP] ${mutation.name} -- anchor not found`)
      problems += 1
      continue
    }
    let mutated = original.replace(mutation.from, mutation.to)
    if (mutation.to2 !== undefined) {
      if (!mutated.includes(mutation.to2)) {
        console.error(`  [SKIP] ${mutation.name} -- second anchor not found`)
        problems += 1
        continue
      }
      mutated = mutated.replace(mutation.to2, mutation.replacement2)
    }
    writeFileSync(mutation.file, mutated, 'utf8')
    const result = runSuite()
    writeFileSync(mutation.file, original, 'utf8')

    // Validate the sabotage before believing the red: a mutation that stops the
    // file compiling fails every test and proves nothing about any of them.
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
  for (const [file, text] of originals) writeFileSync(file, text, 'utf8')
}

console.error(`\n${problems === 0 ? 'ALL MUTATIONS CAUGHT' : `${problems} MUTATION(S) UNACCOUNTED FOR`}`)
process.exit(problems === 0 ? 0 : 1)
