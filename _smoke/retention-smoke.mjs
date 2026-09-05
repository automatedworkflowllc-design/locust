// Retention smoke: pruning old missions from Settings, in the built app.
//
//   node _smoke/retention-smoke.mjs
//
// Starts NO mission and spends no provider quota. It writes a ledger by hand
// -- an old mission, an old one whose reply is recent, and a recent one --
// then drives the Settings control: the preview must name what it would keep
// as well as what it would delete, must delete nothing by itself, and the
// confirmation must remove exactly the files the preview named.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9225
const DAY = 24 * 60 * 60 * 1000

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (waiter === undefined) return
      this.pending.delete(message.id)
      waiter.resolve(message)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    const settleTimers = new Set()
    const clearTimers = () => { for (const t of settleTimers) clearInterval(t) }
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve: (m) => { clearTimers(); resolve(m) } })),
      new Promise((resolve) => {
        // One timer, cleared when the answer wins and unref()'d: the sleep loop
        // this replaced kept the process alive for up to 300s after the
        // last line (six smokes 'not exiting cleanly', QA on 0.21.2).
        let ticks = 0
        const tick = setInterval(() => {
          ticks += 1
          if (child.exitCode !== null) { clearInterval(tick); resolve({ error: { message: `app exited ${child.exitCode} mid-step` } }) }
          else if (ticks >= 300) { clearInterval(tick); resolve({ error: { message: 'cdp timeout' } }) }
        }, 1000)
        tick.unref()
        settleTimers.add(tick)
        })
    ])
  }
  async eval(expression) {
    const message = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (message.error) throw new Error(JSON.stringify(message.error))
    const result = message.result
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return result?.result?.value
  }
}

const profile = await mkdtemp(join(tmpdir(), 'locust-retention-smoke-'))
await mkdir(profile, { recursive: true })
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: new Date().toISOString() }],
    missionOwners: {},
    settings: { swarm: false }
  })
)

// A ledger written by hand, at the current schema version, so the app finds a
// history that is genuinely old without waiting a year for one.
const LEDGER_DIR = join(profile, 'mission-ledger')
await mkdir(LEDGER_DIR, { recursive: true })
const at = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString()
const seeded = [
  ['mission_ancient', 200, undefined],
  ['mission_root', 200, undefined],
  ['mission_reply', 1, 'mission_root'],
  ['mission_fresh', 2, undefined]
]
for (const [missionId, daysAgo, continuesFrom] of seeded) {
  const createdAt = at(daysAgo)
  const metadata = {
    missionId,
    runId: `run_${missionId}`,
    prompt: 'Seeded by the retention smoke.',
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0',
    workspaceId: 'ws_smoke',
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt,
    ...(continuesFrom === undefined
      ? {}
      : { continuesFrom: { missionId: continuesFrom, checkpointEpoch: 1, reason: 'follow-up' } })
  }
  await writeFile(
    join(LEDGER_DIR, `${missionId}.jsonl`),
    `${JSON.stringify({ schemaVersion: 7, recordType: 'mission.created', ledgerSequence: 1, occurredAt: createdAt, metadata })}\n`,
    'utf8'
  )
}

const ledgerNames = async () =>
  (await readdir(LEDGER_DIR)).filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -6)).sort()

const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts on a seeded history')
  check('four missions were seeded', (await ledgerNames()).length === 4)
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // not yet
    }
  }
  check('renderer target available', page !== undefined, child.exitCode === null ? undefined : `app exited ${child.exitCode}`)
  if (page === undefined) {
    say(appOutput.join(''))
    process.exit(1)
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  say('2. Settings states what the history costs')
  const opened = await cdp.eval(`(async () => {
    const nav = [...document.querySelectorAll('button')].find(b => /^settings$/i.test(b.innerText.trim()))
    if (!nav) return JSON.stringify({ found: false })
    nav.click()
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const label = [...document.querySelectorAll('.lc-receipt dt')].find(n => /^on disk$/i.test(n.innerText.trim()))
      const value = label?.nextElementSibling?.innerText?.trim() ?? ''
      if (value && !/measuring/.test(value)) return JSON.stringify({ found: true, value })
    }
    return JSON.stringify({ found: true, value: '(never measured)' })
  })()`)
  const openedState = JSON.parse(opened)
  say(`       on disk: ${openedState.value ?? '(no settings screen)'}`)
  check('Settings opened', openedState.found === true)
  check('it counts the seeded missions', /4 missions/.test(openedState.value ?? ''), openedState.value)

  say('3. the preview names what it would keep, and deletes nothing')
  const preview = await cdp.eval(`(async () => {
    const chip = [...document.querySelectorAll('.lc-chip')].find(b => /90 days/.test(b.innerText))
    if (chip) chip.click()
    await new Promise(r => setTimeout(r, 200))
    const review = [...document.querySelectorAll('.lc-retention button')].find(b => /review/i.test(b.innerText))
    if (!review) return JSON.stringify({ found: false })
    review.click()
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const plan = document.querySelector('.lc-retention__plan')
      if (plan) return JSON.stringify({ found: true, text: plan.innerText.replace(/\\s+/g, ' ').trim() })
    }
    return JSON.stringify({ found: false })
  })()`)
  const previewState = JSON.parse(preview)
  say(`       preview: ${previewState.text ?? '(none)'}`)
  check('a plan was shown', previewState.found === true, preview)
  check('it would delete the one genuinely old mission', /Delete 1 mission for good/.test(previewState.text ?? ''), previewState.text)
  check('and says the conversation root is kept', /1 mission kept as part of a conversation you are keeping/.test(previewState.text ?? ''), previewState.text)
  check('the preview deleted nothing', (await ledgerNames()).length === 4, (await ledgerNames()).join(', '))

  say('4. confirming deletes exactly that mission')
  const confirmed = await cdp.eval(`(async () => {
    const go = [...document.querySelectorAll('.lc-retention__plan button')].find(b => /delete them for good/i.test(b.innerText))
    if (!go) return JSON.stringify({ found: false })
    go.click()
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const notes = [...document.querySelectorAll('.lc-retention .lc-settings__note')].map(n => n.innerText.trim())
      const done = notes.find(text => /^Deleted /.test(text))
      if (done) {
        const label = [...document.querySelectorAll('.lc-receipt dt')].find(n => /^on disk$/i.test(n.innerText.trim()))
        return JSON.stringify({ found: true, done, disk: label?.nextElementSibling?.innerText?.trim() ?? '' })
      }
    }
    return JSON.stringify({ found: false })
  })()`)
  const confirmedState = JSON.parse(confirmed)
  say(`       result: ${confirmedState.done ?? '(none)'} · on disk now: ${confirmedState.disk ?? ''}`)
  check('the app reported the deletion', /Deleted 1 mission\b/.test(confirmedState.done ?? ''), confirmed)
  const left = await ledgerNames()
  check('exactly the old standalone mission is gone', left.join(',') === 'mission_fresh,mission_reply,mission_root', left.join(','))
  check('the on-disk count was re-read from the ledger', /3 missions/.test(confirmedState.disk ?? ''), confirmedState.disk)
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-2000))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\nretention smoke passed')
