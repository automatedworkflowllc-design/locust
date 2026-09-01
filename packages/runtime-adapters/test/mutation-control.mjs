// Mutation control for the app-server client.
//
// This client sits on an experimental protocol and handles the approval
// channel, so its bounds and its request/response correlation are the parts
// that must not quietly rot. A green suite over them is not evidence; each
// invariant has to be shown to fail when broken.
//
//   node test/mutation-control.mjs
//
// Breaks one behaviour at a time, requires the NAMED test to fail, rejects any
// mutation that stops the file running, and restores the file afterwards.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'src', 'app-server.ts')

const MUTATIONS = [
  {
    name: 'a server request is mistaken for a response',
    from: '    if (hasId && method === undefined) {',
    to: '    if (hasId) {',
    expect: 'does not confuse a server request with a response'
  },
  {
    name: 'a handler failure leaves the server waiting forever',
    from: '          if (disposed) return\n          options.transport.send(\n            `${JSON.stringify({\n              jsonrpc: \'2.0\',\n              id: request.id,\n              error: { code: -32_000, message: \'The client could not answer this request.\' }\n            })}\\n`\n          )',
    to: '          void 0',
    expect: 'still answers when the handler throws'
  },
  {
    name: 'the buffer grows without bound',
    from: '      if (Buffer.byteLength(buffer, \'utf8\') > maxBufferedBytes) {',
    to: '      if (false) {',
    expect: 'drops a buffer that grows without a newline rather than growing forever'
  },
  {
    name: 'an oversized line is accepted',
    from: '    if (Buffer.byteLength(trimmed, \'utf8\') > maxLineBytes) {',
    to: '    if (false) {',
    expect: 'drops an oversized single line but keeps the connection usable'
  },
  {
    name: 'requests are never timed out',
    from: '        const timer = setTimeout(() => {',
    to: '        const timer = setTimeout(() => { if (true) return;',
    expect: 'times out a request the server never answers'
  },
  {
    name: 'the in-flight limit is not enforced',
    from: '      if (pending.size >= maxPending) {',
    to: '      if (false) {',
    expect: 'refuses to queue beyond its in-flight limit'
  },
  {
    name: 'dispose leaves in-flight requests hanging',
    from: '      for (const id of [...pending.keys()]) {\n        settle(id, (entry) => entry.reject(new Error(reason)))\n      }',
    to: '      void 0',
    expect: 'fails every in-flight request on dispose instead of hanging'
  },
  {
    name: 'an unexpected response is swallowed',
    from: "        diagnostic({ code: 'unknown-response', message: 'A response arrived for an unknown request.' })",
    to: '        void 0',
    expect: 'reports a response nobody asked for rather than dropping it silently'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report FIRST: a run that dies before writing one would leave the
  // previous report in place, and a stale green would read as "this mutation
  // broke nothing" -- a check that cannot go red, inside the tool that exists
  // to prove checks can.
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

const original = readFileSync(CLIENT, 'utf8')
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
    writeFileSync(CLIENT, original.replace(mutation.from, mutation.to), 'utf8')
    const result = runSuite()
    writeFileSync(CLIENT, original, 'utf8')

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
  writeFileSync(CLIENT, original, 'utf8')
  rmSync(REPORT, { force: true })
}

console.error(`\n${problems === 0 ? 'ALL MUTATIONS CAUGHT' : `${problems} MUTATION(S) UNACCOUNTED FOR`}`)
process.exit(problems === 0 ? 0 : 1)
