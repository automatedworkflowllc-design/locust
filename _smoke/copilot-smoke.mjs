// Copilot smoke: GitHub Copilot CLI as a route, end to end.
//
//   node _smoke/copilot-smoke.mjs
//
// Picks Copilot CLI / Auto through the UI, runs a read-only mission that is
// told to write and must not, then a write mission that edits a file, and
// checks the thread reached a terminal state, the file really changed, the
// diff view shows the change, and the ledger recorded runtime copilot with a
// run.completed receipt naming the session id the host minted.
//
// Needs `copilot` signed in on a plan that includes the CLI. Costs premium
// requests on that plan: two short runs.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9235
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const MODEL_SEARCH = 'auto'
const TARGET = 'notes.ts'

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
        // this replaced kept the process alive for up to 400s after the
        // last line (six smokes 'not exiting cleanly', QA on 0.21.2).
        let ticks = 0
        const tick = setInterval(() => {
          ticks += 1
          if (child.exitCode !== null) { clearInterval(tick); resolve({ error: { message: `app exited ${child.exitCode} mid-step` } }) }
          else if (ticks >= 400) { clearInterval(tick); resolve({ error: { message: 'cdp timeout' } }) }
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

const profile = await mkdtemp(join(tmpdir(), 'locust-copilot-smoke-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-copilot-work-'))
await mkdir(profile, { recursive: true })
await writeFile(
  join(workspace, TARGET),
  ['export const status = "draft";', '', 'export function describe(): string {', '  return status;', '}', ''].join('\n'),
  'utf8'
)
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: new Date().toISOString() }],
    missionOwners: {},
    settings: { swarm: false, relay: false }
  })
)
const LEDGER_DIR = join(profile, 'mission-ledger')

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

/** Pick a route by searching the picker; keeps searching while the model list arrives. */
const pickRoute = (group, search, label) => `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  control.click()
  await new Promise(r => setTimeout(r, 400))
  let target
  for (let attempt = 0; attempt < 120 && !target; attempt += 1) {
    const picker = document.querySelector('.lc-picker')
    if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
    const input = picker.querySelector('.lc-picker__input')
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(input, ${JSON.stringify(search)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    let heading = ''
    for (const node of picker.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) heading = header.innerText
      const row = node.querySelector('.lc-picker__row')
      const text = row ? row.innerText.toLowerCase().replace(/[-_/.:]+/g, ' ').replace(/[ ]+/g, ' ').trim() : ''
      if (row && !row.disabled && new RegExp(${JSON.stringify(group)}, 'i').test(heading) && text.includes(${JSON.stringify(label)})) { target = row; break }
    }
    if (!target) await new Promise(r => setTimeout(r, 500))
  }
  if (!target) return JSON.stringify({ picked: false, rows: [...document.querySelectorAll('.lc-picker__row')].map(r => r.innerText).slice(0, 8) })
  target.click()
  await new Promise(r => setTimeout(r, 400))
  return JSON.stringify({ picked: true, controls: [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/[^a-z0-9 ./-]+/gi, ' ').trim()) })
})()`

const setMode = (label) => `(async () => {
  const modeControl = [...document.querySelectorAll('.lc-control')].find(b => /ask|accept|approve/i.test(b.innerText))
  if (!modeControl) return 'no mode control'
  modeControl.click()
  await new Promise(r => setTimeout(r, 400))
  const item = [...document.querySelectorAll('[role="menuitem"], button')].find(b => b.innerText.trim().toLowerCase().startsWith(${JSON.stringify(label)}) && !b.disabled)
  if (!item) return 'no item'
  item.click()
  await new Promise(r => setTimeout(r, 400))
  return [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/[^a-z0-9 ./-]+/gi, ' ').trim()).join(' | ')
})()`

const runMission = (prompt) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(prompt)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  let clicked = false
  for (let i = 0; i < 120; i += 1) {
    await new Promise(r => setTimeout(r, 250))
    const send = document.querySelector('form.command-dock .send-button')
    if (send && !send.disabled && /Start mission|Send/.test(send.getAttribute('aria-label') || '')) { send.click(); clicked = true; break }
  }
  if (!clicked) return JSON.stringify({ started: false, placeholder: field.placeholder })
  let sawRunning = false
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 1000))
    const stop = document.querySelector('button[aria-label^="Stop the running"]')
    if (stop) sawRunning = true
    if (sawRunning && !stop && /completed|failed|cancelled/i.test((document.querySelector('.lc-workroom__header') || document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText)) {
      return JSON.stringify({
        started: true,
        done: true,
        header: (document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText,
        reply: [...document.querySelectorAll('.lc-agentline')].map(n => n.innerText).join(' '),
        error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText
      })
    }
  }
  return JSON.stringify({ started: true, done: false })
})()`

try {
  say('1. the app starts')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // not up yet
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
  const discovered = await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control && /cursor|codex|claude|opencode|copilot/i.test(control.innerText)) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  })()`)
  check('discovery finished', discovered === true)

  say('2. Copilot CLI is offered as Auto, and can be picked')
  const picked = JSON.parse(await cdp.eval(pickRoute('copilot', MODEL_SEARCH, 'auto')))
  check('Auto is selectable under Copilot CLI', picked.picked === true, JSON.stringify(picked).slice(0, 300))
  say(`       controls: ${JSON.stringify(picked.controls)}`)
  check('the route control reads Copilot CLI', (picked.controls ?? []).some((text) => /copilot/i.test(text)), JSON.stringify(picked.controls))

  say('3. a read-only mission: the model names itself and cannot write')
  say(`       mode: ${await cdp.eval(setMode('ask'))}`)
  const readOnly = JSON.parse(await cdp.eval(runMission(`Create a file named blocked.txt containing hi if you can. Then, whatever happened, reply with one line that starts with MODEL: followed by the model you are.`)))
  check('the read-only run reached a terminal state', readOnly.started === true && readOnly.done === true, JSON.stringify(readOnly).slice(0, 200))
  check('it completed rather than failed', /completed/.test(readOnly.header ?? '') && !readOnly.error, readOnly.error || readOnly.header)
  say(`       reply: ${(readOnly.reply ?? '').replace(/\s+/g, ' ').slice(0, 160)}`)
  const blocked = await readFile(join(workspace, 'blocked.txt'), 'utf8').catch(() => undefined)
  check('read-only held: no file was created', blocked === undefined)

  say('4. a write mission: a real edit, shown as a diff')
  say(`       mode: ${await cdp.eval(setMode('accept'))}`)
  const wrote = JSON.parse(await cdp.eval(runMission(`Edit ${TARGET}: change the word "draft" to "final" on the line that has it. Change nothing else. Then reply DONE.`)))
  check('the write run reached a terminal state', wrote.started === true && wrote.done === true, JSON.stringify(wrote).slice(0, 200))
  check('it completed rather than failed', /completed/.test(wrote.header ?? '') && !wrote.error, wrote.error || wrote.header)
  const after = await readFile(join(workspace, TARGET), 'utf8').catch(() => '')
  check('the file on disk really changed', /final/.test(after) && !/draft/.test(after), JSON.stringify(after).slice(0, 120))
  const activity = await cdp.eval(`(async () => {
    const card = [...document.querySelectorAll('.lc-activity')].pop()
    if (!card) return JSON.stringify({ card: false })
    if (card.getAttribute('aria-expanded') !== 'true') card.click()
    await new Promise(r => setTimeout(r, 400))
    const list = card.parentElement.querySelector('.lc-activity__list')
    const rows = [...(list ? list.querySelectorAll('.lc-filerow') : [])].map(r => r.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify({ card: true, summary: card.innerText.replace(/\\s+/g, ' ').trim(), rows })
  })()`)
  const shown = JSON.parse(activity)
  say(`       activity: ${shown.summary ?? '(none)'} · rows: ${JSON.stringify(shown.rows ?? [])}`)
  check('the activity card lists the edited file', shown.card === true && (shown.rows ?? []).some((row) => row.includes(TARGET)), JSON.stringify(shown))

  say('5. the ledger recorded Copilot missions')
  const names = (await readdir(LEDGER_DIR).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  check('two mission ledgers exist', names.length === 2, `ledgers: ${names.length}`)
  for (const name of names) {
    const records = (await readFile(join(LEDGER_DIR, name), 'utf8')).split('\n').filter((l) => l).map((l) => JSON.parse(l))
    const header = records[0]?.metadata
    const events = records.filter((r) => r.recordType === 'mission.event').map((r) => r.event)
    say(`       ${name.slice(0, 16)}… sandbox ${header?.sandbox} · tools: ${events.filter((e) => e?.type === 'tool.started').map((e) => e.payload?.name).join(', ') || '(none)'}`)
    check(`${name.slice(0, 16)}… records runtime copilot`, header?.runtime === 'copilot', JSON.stringify({ runtime: header?.runtime, model: header?.model }))
    check('every event is signed by the Copilot normalizer', events.length > 0 && events.every((e) => e?.sourceAdapter === 'copilot'), `events: ${events.length}`)
    check('a run.completed receipt names the session', events.some((e) => e?.type === 'run.completed' && typeof e.runtimeThreadId === 'string' && /^[0-9a-f-]{36}$/.test(String(e.runtimeThreadId))))
  }
} finally {
  child.kill()
  await sleep(500)
  // `--keep` leaves the profile behind so a FAILING run can be read after the
  // fact: its ledger holds the argv the host ran, the process evidence and the
  // events that arrived. Diagnosing the 2026-09-05 Copilot failure meant
  // reconstructing all three by hand, because the evidence was deleted the
  // moment the smoke finished.
  if (process.argv.includes('--keep')) {
    say(`profile kept at ${profile}`)
  } else {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

console.error(failures === 0 ? '\nCOPILOT SMOKE PASSED' : `\n${failures} COPILOT SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
