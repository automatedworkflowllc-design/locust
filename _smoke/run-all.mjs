// Run every live smoke and report which ones still hold.
//
//   node _smoke/run-all.mjs [--only a,b] [--skip c,d]
//
// The smokes are the only checks that run the product against a real provider
// and a real build, and the README says they are "run by hand and their
// results reported". Run by hand means, in practice, rarely and not all
// together -- so the honest state of the suite has never been known at one
// moment. Before handing the app to anyone else, it should be.
//
// Each runs in its own process with its own timeout, because a smoke that
// hangs must not take the sweep with it. Results are printed as a table with
// the failing assertions quoted, so a red one can be acted on without
// re-running it.

import { spawn } from 'node:child_process'
import { SMOKE_PORTS, assertPortsAreUnique, waitForPortFree } from './ports.mjs'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.slice(1)
const ROOT = join(HERE, '..')

/** Longer than any smoke should need; a smoke past this is a finding itself. */
const TIMEOUT_MS = 15 * 60 * 1000

// `--only a,b` and `--only=a,b` alike: the usage line above says the first, and a run given it once
// ignored it and ran EVERY smoke, the paid runtimes' too (2026-10-06).
const argument = (name) => {
  const found = process.argv.find((entry) => entry.startsWith(`--${name}=`))
  if (found !== undefined) return found.slice(name.length + 3)
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}
const only = argument('only')?.split(',').map((entry) => entry.trim()).filter(Boolean)
const skip = (argument('skip')?.split(',').map((entry) => entry.trim()).filter(Boolean)) ?? []

const all = (await readdir(HERE))
  .filter((name) => name.endsWith('-smoke.mjs'))
  .map((name) => name.replace(/-smoke\.mjs$/, ''))
  .sort()

const chosen = all.filter((name) => (only === undefined || only.includes(name)) && !skip.includes(name))
// Every smoke at once runs the paid runtimes too (Claude, Codex, Cursor, Copilot, Antigravity, Muse):
// only on purpose. A run with no --only must say LOCUST_SPEND=1.
if (only === undefined && process.env.LOCUST_SPEND !== '1') {
  console.error('Running every smoke includes paid runtimes. Name the ones to run with --only a,b, or set LOCUST_SPEND=1 to run them all.')
  process.exit(2)
}

const say = (line) => console.error(line)
say(`running ${String(chosen.length)} of ${String(all.length)} smokes`)
say('')

const results = []
/*
 * Two smokes on one port was most of this suite's flaky tail.
 *
 * MEASURED 2026-09-11: eleven port numbers were used twice, and because the
 * sweep runs alphabetically several collided at close range -- schedule and
 * steering both on 9299, two apart; raw-conversation and relay both on 9233,
 * one apart. Each smoke launches an ELECTRON app and this loop waits only for
 * the node process that spawned it, so an app still shutting down still holds
 * its port and the next smoke can attach its CDP client to the wrong window.
 *
 * Unique ports stop that by design. This stops what design cannot: a smoke
 * whose app outlived it, an orphan from an earlier failure, a re-run started
 * too soon.
 */
assertPortsAreUnique()

for (const name of chosen) {
  const started = Date.now()
  const port = SMOKE_PORTS[name]
  if (port !== undefined && !(await waitForPortFree(port))) {
    say(`  WAIT  ${name.padEnd(16)} port ${String(port)} is still held; starting anyway`)
  }
  const output = []
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, `${name}-smoke.mjs`)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const timer = setTimeout(() => {
      child.kill()
      output.push(`\n[timed out after ${String(TIMEOUT_MS / 60000)} minutes]`)
      resolve('timeout')
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => output.push(String(d)))
    child.stderr.on('data', (d) => output.push(String(d)))
    child.on('close', (value) => { clearTimeout(timer); resolve(value) })
    child.on('error', (error) => { clearTimeout(timer); output.push(String(error)); resolve('error') })
  })
  const text = output.join('')
  const failed = [...text.matchAll(/^\s*\[FAIL\].*$/gm)].map((match) => match[0].trim())
  const seconds = Math.round((Date.now() - started) / 1000)
  // A provider that is out of quota is not a product defect, and reporting it
  // as one is how a suite starts crying wolf. Measured on 2026-09-05: the
  // Codex account hit its limit mid-sweep and `follow-up` reported three
  // failed assertions whose text was "Usage limit reached" -- which reads,
  // in a table of PASS and FAIL, exactly like the product breaking.
  const quotaSpent = /usage limit|rate.?limit|resource_exhausted|insufficient_quota|quota (exceeded|exhausted)/i.test(text)
  const outOfQuota = code !== 0 && quotaSpent
  results.push({ name, code, seconds, failed, text, outOfQuota })
  const verdict = code === 0 ? 'PASS' : outOfQuota ? 'QUOTA' : code === 'timeout' ? 'HUNG' : 'FAIL'
  say(`  ${verdict.padEnd(5)} ${name.padEnd(16)} ${String(seconds).padStart(4)}s${failed.length > 0 ? `  (${String(failed.length)} assertions)` : ''}`)
  for (const line of failed.slice(0, 4)) say(`          ${line.slice(0, 150)}`)
}

await writeFile(
  join(ROOT, 'smoke-results.json'),
  JSON.stringify(
    results.map(({ name, code, seconds, failed, text, outOfQuota }) => ({
      name,
      code,
      seconds,
      outOfQuota,
      failed,
      tail: text.slice(-3000)
    })),
    null,
    2
  ),
  'utf8'
)

const passed = results.filter((result) => result.code === 0).length
const quota = results.filter((result) => result.outOfQuota).length
const broken = results.filter((result) => result.code !== 0 && !result.outOfQuota)
say('')
say(`${String(passed)} passed, ${String(broken.length)} failed, ${String(quota)} unusable (provider out of quota)`)
if (quota > 0) {
  say('A QUOTA row proves nothing either way -- it has to be re-run once the provider resets.')
}
for (const result of broken) say(`  still failing: ${result.name}`)
say('Full output in smoke-results.json')
// Out of quota is not a pass. It is also not a failure, and exiting non-zero
// on it would make the sweep unusable exactly when a provider is throttling.
process.exit(broken.length === 0 ? 0 : 1)
