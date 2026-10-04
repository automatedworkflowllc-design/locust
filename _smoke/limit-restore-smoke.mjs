// Does a runtime's usage limit survive a restart?
//
//   node _smoke/limit-restore-smoke.mjs
//
// The 0.21.2 QA pass ran Codex out of quota, saw AT LIMIT in Settings, then
// reloaded before the reset time and watched it turn back into READY with no
// successful Codex run in between. The window remembered the limit; the
// ledger did too, and nobody asked it. Now the history response carries the
// ledger's answer and the window seeds from it at boot.
//
// Two launches on the real app, one record each:
//   A. a mission whose last Codex word was `route.limit_detected` -> the
//      Settings row for Codex wears AT LIMIT on a fresh window
//   B. CONTROL: the same, followed by a later `run.completed` on Codex ->
//      no AT LIMIT, because the account recovered

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)}`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const workspace = await mkdtemp(join(tmpdir(), 'locust-limit-ws-'))
await writeFile(join(workspace, 'README.md'), '# limit\n', 'utf8')
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T02:00:00.000Z'
const T1 = '2026-09-05T02:05:00.000Z'
const T2 = '2026-09-05T02:09:00.000Z'

function missionFile(missionId, events) {
  const metadata = {
    missionId,
    runId: `run_${missionId}`,
    prompt: 'check the google stock price',
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.153.0',
    workspaceId: WORKSPACE_ID,
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: T0
  }
  const lines = [
    JSON.stringify({ schemaVersion: 7, recordType: 'mission.created', ledgerSequence: 1, occurredAt: T0, metadata })
  ]
  events.forEach((event, index) => {
    lines.push(
      JSON.stringify({
        schemaVersion: 7,
        recordType: 'mission.event',
        ledgerSequence: index + 2,
        occurredAt: event.occurredAt,
        event: { ...event, runId: `run_${missionId}`, missionId, sequence: index + 1, id: `${missionId}:${String(index + 1)}` }
      })
    )
  })
  return `${lines.join('\n')}\n`
}

const started = (at) => ({
  type: 'run.started',
  occurredAt: at,
  sourceAdapter: 'codex',
  payload: { runtimeThreadId: 'thread-1', evidence: { redacted: true } }
})
const limited = (at) => ({
  type: 'route.limit_detected',
  occurredAt: at,
  sourceAdapter: 'codex',
  payload: { kind: 'quota-exhausted', message: 'You have hit your usage limit. Try again at 4:00 PM.', evidence: { redacted: true } }
})
const failed = (at) => ({
  type: 'run.failed',
  occurredAt: at,
  sourceAdapter: 'codex',
  payload: { kind: 'quota-exhausted', message: 'Codex invocation did not complete successfully', runtimeTerminal: 'failed', process: { exitCode: 1, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: T0, finishedAt: T1 }, evidence: { redacted: true } }
})
const completed = (at) => ({
  type: 'run.completed',
  occurredAt: at,
  sourceAdapter: 'codex',
  payload: { process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: T0, finishedAt: T1 }, evidence: { redacted: true } }
})

async function launch(files) {
  const profile = await mkdtemp(join(tmpdir(), 'locust-limit-'))
  const ledgerDir = join(profile, 'mission-ledger')
  await mkdir(ledgerDir, { recursive: true })
  await writeFile(
    join(profile, 'teammates.json'),
    JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false } })
  )
  for (const [name, text] of Object.entries(files)) await writeFile(join(ledgerDir, `${name}.jsonl`), text, 'utf8')

  const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = []
  child.stdout.on('data', (d) => output.push(String(d)))
  child.stderr.on('data', (d) => output.push(String(d)))
  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}\n${output.join('').slice(-1200)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up */ }
  }
  if (page === undefined) {
    try { child.kill() } catch { /* gone */ }
    throw new Error(`renderer never came up\n${output.join('').slice(-1200)}`)
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res) => socket.addEventListener('open', res, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const w = pending.get(m.id)
    if (w) { pending.delete(m.id); w(m) }
  })
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((res) => {
        const n = ++id
        pending.set(n, res)
        socket.send(JSON.stringify({ id: n, method, params }))
      }),
      new Promise((resolve) => { const t = setTimeout(() => resolve({ error: { message: 'cdp timeout' } }), 360_000); t.unref() })
    ])
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (m.error) throw new Error(JSON.stringify(m.error))
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return m.result?.result?.value
  }
  await evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      const f = document.querySelector('form.command-dock textarea')
      if (f && !/Checking local runtimes/.test(f.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  const close = async () => {
    try { socket.close() } catch { /* gone */ }
    try { child.kill() } catch { /* gone */ }
    await sleep(1500)
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  return { evaluate, close, output }
}

// The Codex row in Settings, by its tag.
const SETTINGS_CODEX = `(async () => {
  const button = [...document.querySelectorAll('button')].find(b => /^Settings$/.test(b.innerText.trim()))
  button.click()
  await new Promise(r => setTimeout(r, 700))
  const rows = [...document.querySelectorAll('.lc-runtimerow')]
  const codex = rows.find(r => /Codex CLI/.test(r.innerText))
  return JSON.stringify({
    rows: rows.length,
    codexTag: codex?.querySelector('.lc-tag')?.textContent.trim() ?? '',
    codexDetail: codex?.querySelector('.lc-runtimerow__detail')?.textContent.trim() ?? '',
    sidebarMissions: [...document.querySelectorAll('.lc-sidebar .lc-row')].length
  })
})()`

try {
  say('A. the ledger\'s last Codex word was its usage limit')
  {
    const app = await launch({
      mission_limited: missionFile('mission_limited', [started(T0), limited(T1), failed(T1)])
    })
    try {
      // What the host actually answered, before any screen interprets it:
      // the ledger's events by type and the limit it derived from them.
      const answered = await app.evaluate(`window.desktop.getMissionHistory().then(r => JSON.stringify(r.ok ? { limited: r.data.limitedRuntimes, issues: r.data.issueCount, events: r.data.missions.map(m => [m.missionId, m.phase, m.events.map(e => e.type)]) } : r))`)
      say(`       history: ${answered}`)
      const state = JSON.parse(await app.evaluate(SETTINGS_CODEX))
      say(`       ${JSON.stringify(state)}`)
      check('the mission was read back from the ledger', state.sidebarMissions >= 1, String(state.sidebarMissions))
      check('Settings lists the runtimes', state.rows >= 5, String(state.rows))
      check('Codex wears AT LIMIT on a fresh window', state.codexTag === 'AT LIMIT', state.codexTag)
      check('with the account\'s own words', /usage limit/i.test(state.codexDetail), state.codexDetail)
    } finally {
      await app.close()
    }
  }

  say('B. CONTROL: a later completed Codex run clears it')
  {
    const app = await launch({
      mission_limited: missionFile('mission_limited', [started(T0), limited(T1), failed(T1)]),
      mission_recovered: missionFile('mission_recovered', [started(T2), completed(T2)])
    })
    try {
      const answered = await app.evaluate(`window.desktop.getMissionHistory().then(r => JSON.stringify(r.ok ? { limited: r.data.limitedRuntimes, issues: r.data.issueCount, events: r.data.missions.map(m => [m.missionId, m.phase, m.events.map(e => e.type)]) } : r))`)
      say(`       history: ${answered}`)
      const state = JSON.parse(await app.evaluate(SETTINGS_CODEX))
      say(`       ${JSON.stringify(state)}`)
      check('both missions were read back', state.sidebarMissions >= 2, String(state.sidebarMissions))
      check('Codex is no longer AT LIMIT', state.codexTag !== 'AT LIMIT', state.codexTag)
    } finally {
      await app.close()
    }
  }
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say(`\n${String(failures)} LIMIT-RESTORE FAILURE(S)`)
  process.exit(1)
}
say('\nlimit-restore smoke passed')
