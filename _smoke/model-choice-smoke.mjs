// Model-choice smoke: the picker offers each runtime's own models, and what
// is picked is what runs.
//
//   node _smoke/model-choice-smoke.mjs
//
// Codex's models come from a live `model/list`; Claude Code's from the aliases
// its CLI advertises in its own help. This picks a Claude Code model through
// the UI, runs a one-line mission, and checks the ledger recorded THAT model.
//
// It used to pick `fable` at HIGH effort, ungated, which is the most
// expensive combination on the menu -- and the thing being tested is that
// what you pick is what runs, which any model proves equally well. Colin,
// 2026-09-09: "use cheap claude models, please no fable". Sonnet at low
// effort. The picker is still checked for fable and opus by READING it,
// which costs nothing.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
const CODEX_BIN_DIR = join(homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'b99306303521e97e')
const NPM_DIR = join(homedir(), 'AppData', 'Roaming', 'npm')
const PROMPT = 'Reply with exactly one line naming the model you are. Do not read any files and do not run anything.'

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

const profile = await mkdtemp(join(tmpdir(), 'locust-model-smoke-'))
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
const LEDGER_DIR = join(profile, 'mission-ledger')

const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
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

  say('2. the picker offers each runtime its own models')
  const rows = await cdp.eval(`(async () => {
    const openPicker = () => {
      const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control) control.click()
    }
    for (let i = 0; i < 120; i += 1) {
      openPicker()
      await new Promise(r => setTimeout(r, 250))
      const picker = document.querySelector('.lc-picker')
      if (!picker) continue
      const out = []
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText.trim()
        const row = node.querySelector('.lc-picker__row')
        if (row) out.push({ group, text: row.innerText.replace(/\\s+/g, ' ').trim(), disabled: row.disabled })
      }
      const claudeRows = out.filter(r => /claude/i.test(r.group))
      // Wait until the catalog has been read: Claude rows beyond account-default.
      if (claudeRows.some(r => /fable|opus|sonnet/i.test(r.text))) { openPicker(); return JSON.stringify(out) }
      openPicker()
    }
    return JSON.stringify([])
  })()`)
  const picked = JSON.parse(rows)
  const codexRows = picked.filter((row) => /codex/i.test(row.group))
  const claudeRows = picked.filter((row) => /claude/i.test(row.group))
  say(`       codex: ${codexRows.map((r) => r.text.split(' ')[0]).join(', ')}`)
  say(`       claude: ${claudeRows.map((r) => r.text.split(' ')[0]).join(', ')}`)
  check('Codex lists its real models', codexRows.some((row) => /gpt-5/i.test(row.text)), JSON.stringify(codexRows).slice(0, 200))
  check('Claude Code lists the aliases its CLI advertises', ['fable', 'opus', 'sonnet'].every((alias) => claudeRows.some((row) => new RegExp(`^${alias}`, 'i').test(row.text))), JSON.stringify(claudeRows).slice(0, 300))
  check('Claude aliases carry effort levels', claudeRows.some((row) => /effort levels/.test(row.text) && /max/.test(row.text)), claudeRows[0]?.text)
  check('no Codex model is offered under Claude', !claudeRows.some((row) => /gpt-5/i.test(row.text)))

  say('3. pick Claude Code / sonnet at low effort and run')
  const chosen = await cdp.eval(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    control.click()
    await new Promise(r => setTimeout(r, 300))
    const picker = document.querySelector('.lc-picker')
    let group = ''
    let target
    for (const node of picker.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) group = header.innerText
      const row = node.querySelector('.lc-picker__row')
      if (row && !row.disabled && /claude/i.test(group) && /^sonnet/i.test(row.innerText.trim())) { target = row; break }
    }
    if (!target) return JSON.stringify({ picked: false })
    target.click()
    await new Promise(r => setTimeout(r, 300))
    const effortButton = [...document.querySelectorAll('.lc-control')].find(b => /effort/i.test(b.getAttribute('aria-label') || '') || /effort/i.test(b.title || ''))
    let effortPicked = 'no effort control'
    if (effortButton && !effortButton.disabled) {
      effortButton.click()
      await new Promise(r => setTimeout(r, 300))
      const option = [...document.querySelectorAll('[role="menu"] button, .lc-menu button, .lc-picker__row')].find(b => /^high\\b/i.test(b.innerText.trim()))
      if (option) { option.click(); effortPicked = 'high' } else { effortPicked = 'no high option'; effortButton.click() }
    } else if (effortButton) {
      effortPicked = 'effort control disabled'
    }
    await new Promise(r => setTimeout(r, 200))
    const controls = [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify({ picked: true, effortPicked, controls })
  })()`)
  const chosenState = JSON.parse(chosen)
  check('sonnet is selectable under Claude Code', chosenState.picked === true, chosen)
  say(`       controls: ${JSON.stringify(chosenState.controls)} · effort: ${chosenState.effortPicked}`)
  check('the route control shows Claude Code / sonnet', (chosenState.controls ?? []).some((text) => /claude/i.test(text) && /sonnet/i.test(text)), JSON.stringify(chosenState.controls))

  const submitted = await cdp.eval(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const send = document.querySelector('form.command-dock .send-button')
      if (send && !send.disabled && send.getAttribute('aria-label') === 'Send') { send.click(); return 'clicked' }
    }
    return 'send stayed disabled'
  })()`)
  check('the mission was submitted', submitted === 'clicked', submitted)
  const outcome = await cdp.eval(`(async () => {
    let sawRunning = false
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) sawRunning = true
      const marker = /completed|failed|cancelled/i.test((document.querySelector('.lc-workroom__header') || document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText)
      const done = sawRunning && !stop && marker
      if (done) {
        return JSON.stringify({
          done: true,
          header: (document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText,
          reply: [...document.querySelectorAll('.lc-agentline')].map(n => n.innerText).join(' '),
          error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText
        })
      }
    }
    return JSON.stringify({ done: false })
  })()`)
  const result = JSON.parse(outcome)
  check('the run reached a terminal state', result.done === true)
  say(`       header: ${(result.header ?? '').replace(/\s+/g, ' ')}`)
  say(`       reply: ${(result.reply ?? '').replace(/\s+/g, ' ').slice(0, 160)}`)
  if (result.error) say(`       error card: ${result.error.replace(/\s+/g, ' ').slice(0, 300)}`)
  check('the run completed rather than failed', /completed/.test(result.header ?? '') && !result.error, result.error || result.header)

  say('4. the ledger recorded the model that was picked')
  const names = (await readdir(LEDGER_DIR).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const records = names.length === 1 ? (await readFile(join(LEDGER_DIR, names[0]), 'utf8')).split('\n').filter((l) => l).map((l) => JSON.parse(l)) : []
  const header = records[0]?.metadata
  check('one mission ledger exists', names.length === 1, `ledgers: ${names.length}`)
  check('it records runtime claude and model sonnet', header?.runtime === 'claude' && header?.model === 'sonnet', JSON.stringify({ runtime: header?.runtime, model: header?.model }))
  const completed = records.some((r) => r.recordType === 'mission.event' && r.event?.type === 'run.completed')
  check('and a run.completed receipt', completed)
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-3000))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\nmodel-choice smoke passed')
