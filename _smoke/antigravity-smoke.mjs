// Antigravity smoke: the experimental route, end to end, in a folder that
// Antigravity itself has open.
//
//   node _smoke/antigravity-smoke.mjs [C:\path\to\a\folder\Antigravity\has\open]
//
// Antigravity must be RUNNING with that folder open (default: the
// antigravtest folder used while measuring). The smoke launches the app with
// that folder as its workspace, expects the picker to offer Antigravity
// tagged EXPERIMENTAL with the three Gemini tiers, runs a write mission on
// the flash tier, and checks that the file really appeared, the thread ended
// in a completed state with the agent's final answer, and the ledger recorded
// runtime antigravity with a run.completed receipt naming the conversation.
//
// Costs Antigravity quota: one short flash conversation.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
const WORKSPACE = process.argv[2] ?? 'C:\\Users\\<home>\\Documents\\antigravtest'
const TARGET = 'locust-smoke.txt'
const CODE = 'PEBBLE-' + String(Math.floor(Math.random() * 9000) + 1000)

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
        // this replaced kept the process alive for up to 600s after the
        // last line (six smokes 'not exiting cleanly', QA on 0.21.2).
        let ticks = 0
        const tick = setInterval(() => {
          ticks += 1
          if (child.exitCode !== null) { clearInterval(tick); resolve({ error: { message: `app exited ${child.exitCode} mid-step` } }) }
          else if (ticks >= 600) { clearInterval(tick); resolve({ error: { message: 'cdp timeout' } }) }
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

const profile = await mkdtemp(join(tmpdir(), 'locust-antigravity-smoke-'))
await mkdir(profile, { recursive: true })
await unlink(join(WORKSPACE, TARGET)).catch(() => undefined)
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
  cwd: WORKSPACE,
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say(`1. the app starts in ${WORKSPACE}`)
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
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

  say('2. Antigravity is offered, tagged EXPERIMENTAL, with its three tiers')
  const picked = JSON.parse(await cdp.eval(`(async () => {
    let control
    for (let i = 0; i < 240; i += 1) {
      control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control && /cursor|codex|claude|opencode|copilot|antigravity/i.test(control.innerText)) break
      await new Promise(r => setTimeout(r, 500))
    }
    control.click()
    await new Promise(r => setTimeout(r, 400))
    let target, tags = [], rows = []
    for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      const input = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(input, 'antigravity')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      let heading = ''
      rows = []
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) heading = header.innerText
        const row = node.querySelector('.lc-picker__row')
        if (!row) continue
        const text = row.innerText.replace(/[^a-z0-9 ]+/gi, ' ').replace(/ +/g, ' ').trim().toLowerCase()
        if (/antigravity/i.test(heading)) {
          rows.push(text)
          const tag = row.querySelector('.lc-picker__tag')
          if (tag) tags.push(tag.innerText.trim())
          if (!row.disabled && text.includes('gemini flash') && !text.includes('lite')) target = row
        }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return JSON.stringify({ picked: false, rows, tags })
    target.click()
    await new Promise(r => setTimeout(r, 400))
    const modeControl = [...document.querySelectorAll('.lc-control')].find(b => /ask|accept|approve/i.test(b.innerText))
    if (modeControl) {
      modeControl.click()
      await new Promise(r => setTimeout(r, 400))
      const item = [...document.querySelectorAll('[role="menuitem"], button')].find(b => /accept edits/i.test(b.innerText) && !b.disabled)
      if (item) item.click()
      await new Promise(r => setTimeout(r, 400))
    }
    return JSON.stringify({ picked: true, rows, tags, controls: [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/[^a-z0-9 ./-]+/gi, ' ').trim()) })
  })()`))
  check('Gemini Flash is selectable under Antigravity', picked.picked === true, JSON.stringify(picked).slice(0, 300))
  say(`       rows: ${JSON.stringify(picked.rows)} · tags: ${JSON.stringify(picked.tags)}`)
  check('every Antigravity row is tagged EXPERIMENTAL or ACTIVE', (picked.tags ?? []).length > 0 && picked.tags.every((tag) => /EXPERIMENTAL|ACTIVE/.test(tag)), JSON.stringify(picked.tags))
  check('the mode control reads Accept edits', (picked.controls ?? []).some((text) => /accept edits/i.test(text)), JSON.stringify(picked.controls))

  say('3. a write mission through Antigravity')
  const result = JSON.parse(await cdp.eval(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(`Create a file named ${TARGET} in this workspace containing exactly the line: ${CODE}. Then reply with the single word DONE.`)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    let clicked = false
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const send = document.querySelector('form.command-dock .send-button')
      if (send && !send.disabled && /Start mission|Send/.test(send.getAttribute('aria-label') || '')) { send.click(); clicked = true; break }
    }
    if (!clicked) return JSON.stringify({ started: false, placeholder: field.placeholder })
    let sawRunning = false
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) sawRunning = true
      if (sawRunning && !stop && /completed|failed|cancelled/i.test((document.querySelector('.lc-workroom__header') || document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText)) {
        return JSON.stringify({
          started: true, done: true,
          header: (document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText,
          reply: [...document.querySelectorAll('.lc-agentline')].map(n => n.innerText).join(' '),
          error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText
        })
      }
    }
    return JSON.stringify({ started: true, done: false, error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText })
  })()`))
  check('the mission reached a terminal state', result.started === true && result.done === true, JSON.stringify(result).slice(0, 300))
  check('it completed rather than failed', /completed/.test(result.header ?? '') && !result.error, result.error || result.header)
  say(`       reply: ${(result.reply ?? '').replace(/\s+/g, ' ').slice(0, 160)}`)
  const written = await readFile(join(WORKSPACE, TARGET), 'utf8').catch(() => undefined)
  check("Antigravity's agent really wrote the file", written !== undefined && written.includes(CODE), JSON.stringify(written ?? null).slice(0, 120))

  say('4. the ledger recorded an Antigravity mission')
  const names = (await readdir(LEDGER_DIR).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  check('one mission ledger exists', names.length === 1, `ledgers: ${names.length}`)
  if (names[0] !== undefined) {
    const records = (await readFile(join(LEDGER_DIR, names[0]), 'utf8')).split('\n').filter((l) => l).map((l) => JSON.parse(l))
    const header = records[0]?.metadata
    const events = records.filter((r) => r.recordType === 'mission.event').map((r) => r.event)
    say(`       sandbox ${header?.sandbox} · model ${header?.model} · tools: ${events.filter((e) => e?.type === 'tool.started').map((e) => e.payload?.name).join(', ') || '(none)'}`)
    check('it records runtime antigravity on the flash tier', header?.runtime === 'antigravity' && header?.model === 'flash', JSON.stringify({ runtime: header?.runtime, model: header?.model }))
    check('every event is signed by the Antigravity normalizer', events.length > 0 && events.every((e) => e?.sourceAdapter === 'antigravity'), `events: ${events.length}`)
    check('a run.completed receipt names the conversation', events.some((e) => e?.type === 'run.completed' && /^[0-9a-f-]{36}$/.test(String(e.runtimeThreadId))))
    check('the write reached the thread as a tool', events.some((e) => e?.type === 'tool.started' && /write/i.test(String(e.payload?.name))))
  }
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await unlink(join(WORKSPACE, TARGET)).catch(() => undefined)
}

console.error(failures === 0 ? '\nANTIGRAVITY SMOKE PASSED' : `\n${failures} ANTIGRAVITY SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
