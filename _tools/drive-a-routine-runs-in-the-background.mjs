// A routine runs from a background launch, with no window (0.575).
//
//   node _tools/drive-a-routine-runs-in-the-background.mjs --packaged <exe>
//
// The login item starts Locust with `--background`: the tray and no window.
// The branch's smoke proved the routine was DISPATCHED (a sink stood in for
// the start); this proves one RUNS: the packaged app, launched the way
// Windows launches it, on a temp profile holding two routines on a free
// OpenCode model --
//   "Due soon", daily at a time a minute or two after launch: it must run,
//   and its run must be in the ledger, finished;
//   "Passed", daily at a time before launch, last run yesterday: it must be
//   recorded as missed and must NOT run.
// And no window may open. Spends nothing (a free route; LOCUST_FREE_ONLY).
// Ends only its own process tree.

import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
if (packaged === undefined) throw new Error('--packaged <exe> is required: only the packaged app registers as a login item.')
if (!FREE_ROUTE.model.startsWith('opencode/') || !FREE_ROUTE.model.endsWith('-free')) throw new Error('This drive requires a free OpenCode route.')

const PORT = 9863
const workspace = await scratchRepository('locust-drive-background-ws-')
const profile = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-background-profile-'))
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const pad = (n) => String(n).padStart(2, '0')
const hhmm = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

// A clock time at least 70 s after launch, so it is due after the app opened.
const launchAt = new Date()
const soon = new Date(launchAt.getTime() + 70_000 + (60_000 - ((launchAt.getTime() + 70_000) % 60_000)))
const passed = new Date(launchAt.getTime() - 5 * 60_000)
const yesterday = new Date(launchAt.getTime() - 26 * 3_600_000).toISOString()
if (soon.getDate() !== launchAt.getDate() || passed.getDate() !== launchAt.getDate()) throw new Error('Too close to midnight for a daily slot; run it again in a few minutes.')

const route = { runtime: 'opencode', model: FREE_ROUTE.model, mode: 'ask' }
await writeFile(join(profile, 'teammates.json'), JSON.stringify({
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_cedar', name: 'Cedar', hue: 'lime', role: 'Custom', roleTitle: 'Office', createdAt: '2026-10-03T00:00:00Z', route }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
}), 'utf8')
const routine = (routineId, name, at) => ({
  routineId, name, teammateId: 'tm_cedar', route,
  steps: ['Do not use tools. Reply with the single word: pineapple.'],
  learnedFrom: [], createdAt: yesterday, runs: 0, lastRunAt: yesterday,
  schedule: { kind: 'daily', at }, workspaceId
})
await writeFile(join(profile, 'routines.json'), JSON.stringify({
  schemaVersion: 1,
  routines: [routine('rt_soon', 'Due soon', hhmm(soon)), routine('rt_passed', 'Passed', hhmm(passed))]
}), 'utf8')

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const pages = async () => {
  try {
    const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
    return list.filter((target) => target.type === 'page')
  } catch {
    return undefined
  }
}
const stored = async () => JSON.parse(await readFile(join(profile, 'routines.json'), 'utf8'))
const byId = (file, id) => file.routines.find((one) => one.routineId === id)

say(`launch ${hhmm(launchAt)}; "Due soon" at ${hhmm(soon)}; "Passed" at ${hhmm(passed)}`)
const env = { ...process.env, LOCUST_FREE_ONLY: '1' }
delete env.LOCUST_SPEND
const child = spawn(packaged, ['--background', `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`, `--workspace=${workspace}`], {
  cwd: profile, env, stdio: ['ignore', 'pipe', 'pipe']
})
const output = []
child.stdout.on('data', (d) => output.push(String(d)))
child.stderr.on('data', (d) => output.push(String(d)))

try {
  // Up and answering, with nothing on screen.
  let answered
  for (let i = 0; i < 40 && answered === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}\n${output.join('').slice(-600)}`)
    answered = await pages()
  }
  check('the background launch is running', answered !== undefined && child.exitCode === null)
  check('it opened no window: no page at all', (answered ?? []).length === 0, JSON.stringify((answered ?? []).map((p) => p.url)))

  // The passed slot: missed, recorded, not started.
  let file
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000)
    file = await stored().catch(() => undefined)
    if (byId(file ?? { routines: [] }, 'rt_passed')?.missedAt !== undefined) break
  }
  const missed = byId(file ?? { routines: [] }, 'rt_passed')
  check('the routine whose time passed before launch is recorded as missed', missed?.missedAt !== undefined && (missed?.history ?? []).some((entry) => entry.kind === 'missed'), JSON.stringify(missed))
  check('and it did not run', (missed?.runs ?? 0) === 0 && missed?.execution === undefined, JSON.stringify({ runs: missed?.runs, execution: missed?.execution }))

  // The slot after launch: it runs, and finishes, with no window.
  const deadline = soon.getTime() + 240_000
  let ran
  while (Date.now() < deadline) {
    await sleep(3000)
    file = await stored().catch(() => file)
    ran = byId(file ?? { routines: [] }, 'rt_soon')
    if ((ran?.runs ?? 0) >= 1 && ran?.execution === undefined) break
  }
  check('the routine due after launch ran to the end, with no window open', (ran?.runs ?? 0) >= 1, JSON.stringify({ runs: ran?.runs, lastRunAt: ran?.lastRunAt, execution: ran?.execution }))
  const ledger = join(profile, 'mission-ledger')
  const missions = (await readdir(ledger).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const texts = await Promise.all(missions.map((name) => readFile(join(ledger, name), 'utf8')))
  const finished = texts.filter((text) => text.includes('pineapple') && text.includes('"run.completed"'))
  check('its run is in the ledger, completed', finished.length >= 1, `${String(missions.length)} mission file(s)`)
  check('still no window', ((await pages()) ?? []).length === 0)
  const passedAfter = byId(file ?? { routines: [] }, 'rt_passed')
  check('the missed routine still has not run', (passedAfter?.runs ?? 0) === 0)
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  // Only this drive's own app: its process tree, by pid.
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
}
say(`profile kept: ${profile}`)
say(failures === 0 ? 'A ROUTINE RUNS IN THE BACKGROUND: PASSED' : `A ROUTINE RUNS IN THE BACKGROUND: FAILED (${String(failures)})`)
process.exit(failures === 0 ? 0 : 1)
