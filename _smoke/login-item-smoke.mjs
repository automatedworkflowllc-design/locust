// Windows sign-in and a background launch, sending nothing to any model.
//
//   node _smoke/login-item-smoke.mjs
//
// Three checks:
//   the switch on puts this executable with --background in the current
//   user's Run key, and off removes it;
//   launching with --background shows no window and the tray;
//   a routine due in one minute is dispatched.
//
// The Run key is snapshotted first and restored in finally, including when a
// check fails. A development copy would register electron.exe, so this smoke
// sets LOCUST_LOGIN_ITEM_SMOKE=1 for the switch only, and
// LOCUST_SCHEDULE_SINK so the due routine is recorded without a model.

import '../_tools/scratch-root.mjs'

import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
const RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const say = (line) => console.error(line)

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) say(`  [PASS] ${label}${detail ? ` -- ${detail}` : ''}`)
  else {
    failures += 1
    say(`  [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`)
  }
}

const pad = (value) => String(value).padStart(2, '0')

function queryRun() {
  try {
    return execFileSync('reg', ['query', RUN], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

function parseRun(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+REG_\w+\s+(.*)$/.exec(line)
    if (match) map.set(match[1], match[2])
  }
  return map
}

function restoreRun(before) {
  const after = parseRun(queryRun())
  for (const [name, data] of after) {
    if (!before.has(name)) {
      execFileSync('reg', ['delete', RUN, '/v', name, '/f'], { stdio: 'ignore' })
    } else if (before.get(name) !== data) {
      execFileSync('reg', ['add', RUN, '/v', name, '/t', 'REG_SZ', '/d', before.get(name), '/f'], { stdio: 'ignore' })
    }
  }
  for (const [name, data] of before) {
    if (!after.has(name)) {
      execFileSync('reg', ['add', RUN, '/v', name, '/t', 'REG_SZ', '/d', data, '/f'], { stdio: 'ignore' })
    }
  }
}

const profile = await mkdtemp(join(tmpdir(), 'locust-login-item-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-login-item-ws-'))
const sink = join(profile, 'schedule-sink.txt')
await mkdir(profile, { recursive: true })
await writeFile(join(workspace, 'README.md'), '# scratch\n', 'utf8')

const lastRunAt = new Date(Date.now() - 24 * 3_600_000).toISOString()
await writeFile(join(profile, 'teammates.json'), JSON.stringify({
  schemaVersion: 1,
  teammates: [{
    teammateId: 'tm_smoke',
    name: 'Smoke',
    hue: 'lime',
    role: 'Ops & Scheduling',
    createdAt: lastRunAt,
    route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' }
  }],
  missionOwners: {},
  missionTitles: {}
}), 'utf8')

const before = parseRun(queryRun())
let child

const stop = async () => {
  if (child === undefined || child.exitCode !== null) return
  try { child.kill() } catch { /* already gone */ }
  for (let i = 0; i < 40 && child.exitCode === null; i += 1) await sleep(250)
}

try {
  try {
    const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (already.ok) {
      check('the debugging port is free', false, `port ${String(PORT)} is in use`)
      process.exit(1)
    }
  } catch {
    // Nothing listening.
  }

  say('1. the switch writes --background into the Run key, and off removes it')
  const output = []
  child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    env: {
      ...process.env,
      LOCUST_LOGIN_ITEM_SMOKE: '1',
      LOCUST_DEFAULT_WORKSPACE: workspace
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => output.push(String(chunk)))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))

  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl && !String(target.url).includes('#splash'))
    } catch { /* not up */ }
  }
  check('the window opened', page !== undefined, child.exitCode === null ? '' : `exited ${String(child.exitCode)}`)
  if (page === undefined) {
    say(output.join('').slice(-1500))
    process.exit(1)
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const evaluate = (expression) => new Promise((resolve) => {
    const next = ++id
    const gaveUp = setTimeout(() => { pending.delete(next); resolve(undefined) }, 60_000)
    pending.set(next, (message) => {
      clearTimeout(gaveUp)
      resolve(message.result?.result?.value)
    })
    socket.send(JSON.stringify({ id: next, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })

  const armed = await evaluate(`(async () => {
    let open
    for (let i = 0; i < 80 && !open; i += 1) {
      open = document.querySelector('button[title="Settings (Ctrl 3)"]')
      if (!open) await new Promise((r) => setTimeout(r, 250))
    }
    if (!open) return 'no settings: ' + (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 240)
    open.click()
    for (let i = 0; i < 40; i += 1) {
      const sw = document.querySelector('button[aria-label="Start Locust when you sign in to Windows."]')
      if (sw && !sw.disabled) return sw.getAttribute('aria-checked')
      await new Promise((r) => setTimeout(r, 250))
    }
    const disabled = document.querySelector('button[aria-label="Start Locust when you sign in to Windows."]')
    return disabled ? 'switch disabled' : 'switch not available'
  })()`)
  check('the sign-in switch can be set', armed === 'false' || armed === 'true', String(armed))
  if (armed !== 'false' && armed !== 'true') {
    say(output.join('').slice(-1500))
  } else {
    if (armed === 'true') {
      await evaluate(`document.querySelector('button[aria-label="Start Locust when you sign in to Windows."]').click()`)
      await sleep(500)
    }
    await evaluate(`document.querySelector('button[aria-label="Start Locust when you sign in to Windows."]').click()`)
    let added
    for (let i = 0; i < 20 && added === undefined; i += 1) {
      await sleep(250)
      const now = parseRun(queryRun())
      for (const [name, data] of now) {
        if (before.get(name) === data) continue
        if (data.includes('--background') && data.toLowerCase().includes('electron.exe')) added = `${name}=${data}`
      }
    }
    check('on puts --background in the Run key', added !== undefined, added ?? queryRun().slice(0, 400))
    await evaluate(`(async () => {
      const sw = document.querySelector('button[aria-label="Start Locust when you sign in to Windows."]')
      if (sw && sw.getAttribute('aria-checked') === 'true') sw.click()
    })()`)
    let cleared = false
    for (let i = 0; i < 20 && !cleared; i += 1) {
      await sleep(250)
      const now = parseRun(queryRun())
      cleared = [...now.entries()].every(([name, data]) => before.get(name) === data) && [...before.keys()].every((name) => now.has(name))
    }
    check('off removes it', cleared)
  }
  try { socket.close() } catch { /* closed */ }
  await stop()
  child = undefined

  // Written now, not at the start: the windowed launch must not find a slot
  // that has already passed and either miss it or send it to a model.
  const due = new Date(Date.now() + 70_000)
  const at = `${pad(due.getHours())}:${pad(due.getMinutes())}`
  await writeFile(join(profile, 'routines.json'), JSON.stringify({
    schemaVersion: 1,
    routines: [{
      routineId: 'rt_smoke',
      name: 'Minute check',
      teammateId: 'tm_smoke',
      route: { runtime: 'cursor', model: 'composer-2.5', mode: 'ask' },
      steps: ['Say the time.'],
      learnedFrom: [],
      createdAt: lastRunAt,
      lastRunAt,
      runs: 0,
      schedule: { kind: 'daily', at }
    }]
  }), 'utf8')

  say('2. --background shows no window, and the tray, and a routine due in one minute runs')
  const backgroundOut = []
  child = spawn(ELECTRON, [APP_DIR, '--background', `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    env: {
      ...process.env,
      LOCUST_DEFAULT_WORKSPACE: workspace,
      LOCUST_SCHEDULE_SINK: sink
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', (chunk) => backgroundOut.push(String(chunk)))
  child.stderr.on('data', (chunk) => backgroundOut.push(String(chunk)))
  let sawPage = false
  let trayLine = false
  for (let i = 0; i < 24; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    if (backgroundOut.join('').includes('Locust is in the tray.')) trayLine = true
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      if (list.some((target) => target.type === 'page')) sawPage = true
    } catch { /* debugger not up yet */ }
  }
  check('no window', child.exitCode === null && !sawPage, child.exitCode === null ? '' : `exited ${String(child.exitCode)}`)
  check('the tray is up', trayLine && child.exitCode === null)
  let dispatched = false
  const deadline = Date.now() + 150_000
  while (Date.now() < deadline && !dispatched && child.exitCode === null) {
    await sleep(2000)
    try {
      dispatched = (await readFile(sink, 'utf8')).includes('rt_smoke')
    } catch { /* not written yet */ }
  }
  check('a routine due in one minute runs', dispatched, `schedule ${at}`)
  await stop()
} finally {
  await stop()
  try { restoreRun(before) } catch (error) {
    say(`  [FAIL] could not restore the Run key -- ${error instanceof Error ? error.message : 'unknown'}`)
    failures += 1
  }
  const after = parseRun(queryRun())
  const same = [...before.entries()].every(([name, data]) => after.get(name) === data) && [...after.keys()].every((name) => before.has(name))
  check('the Run key is as it was found', same)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

process.exit(failures === 0 ? 0 : 1)
