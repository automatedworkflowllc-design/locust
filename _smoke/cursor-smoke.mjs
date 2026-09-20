// Cursor smoke: Cursor Agent is a route like the other two, and a mission
// picked under it runs, streams, and is recorded as Cursor's.
//
//   node _smoke/cursor-smoke.mjs
//
// Needs a signed-in cursor-agent (its launcher dir is put on PATH here the way
// a user's shell would have it). Picks Cursor Agent / composer-2.5 through the
// UI, runs a one-line read-only mission, and checks the thread reached a
// terminal state and the ledger recorded runtime cursor, model composer-2.5,
// with a run.completed receipt signed by the Cursor normalizer.

// FIRST: points tmpdir() outside AppData, where `~/.cursorignore` makes
// every Cursor run blind to the workspace. See _tools/scratch-root.mjs.
import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const CURSOR_DIR = 'C:\\Users\\<home>\\AppData\\Local\\cursor-agent'
const MODEL = 'composer-2.5'
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

const profile = await mkdtemp(join(tmpdir(), 'locust-cursor-smoke-'))
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
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${CURSOR_DIR};${process.env.PATH ?? ''}` },
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

  say('2. the picker offers Cursor Agent its own models')
  const rows = await cdp.eval(`(async () => {
    const openPicker = () => {
      const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control) control.click()
    }
    for (let i = 0; i < 160; i += 1) {
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
      const cursorRows = out.filter(r => /cursor/i.test(r.group))
      if (cursorRows.some(r => /composer|grok/i.test(r.text))) { openPicker(); return JSON.stringify(out) }
      openPicker()
    }
    return JSON.stringify([])
  })()`)
  const picked = JSON.parse(rows)
  const cursorRows = picked.filter((row) => /cursor/i.test(row.group))
  const otherRows = picked.filter((row) => !/cursor/i.test(row.group))
  say(`       cursor: ${cursorRows.map((r) => r.text.split(' ')[0]).slice(0, 8).join(', ')}${cursorRows.length > 8 ? ', …' : ''} (${cursorRows.length})`)
  check('Cursor Agent lists the models its CLI printed', cursorRows.some((row) => /^Composer 2\.5\b/i.test(row.text)) && cursorRows.some((row) => /grok/i.test(row.text)), JSON.stringify(cursorRows).slice(0, 300))
  check('no Cursor model is offered under another runtime', !otherRows.some((row) => /composer|cursor grok/i.test(row.text)))
  check('Cursor rows are selectable', cursorRows.some((row) => !row.disabled))

  say(`3. pick Cursor Agent / ${MODEL} and run`)
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
      if (row && !row.disabled && /cursor/i.test(group) && /^Composer 2\\.5\\b/i.test(row.innerText.trim())) { target = row; break }
    }
    if (!target) return JSON.stringify({ picked: false })
    target.click()
    await new Promise(r => setTimeout(r, 300))
    const controls = [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify({ picked: true, controls })
  })()`)
  const chosenState = JSON.parse(chosen)
  check(`${MODEL} is selectable under Cursor Agent`, chosenState.picked === true, chosen)
  say(`       controls: ${JSON.stringify(chosenState.controls)}`)
  check('the route control shows Cursor Agent / composer-2.5', (chosenState.controls ?? []).some((text) => /cursor/i.test(text) && /composer/i.test(text)), JSON.stringify(chosenState.controls))

  const submitted = await cdp.eval(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const send = document.querySelector('form.command-dock .send-button')
      if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') { send.click(); return 'clicked' }
    }
    return 'send stayed disabled: ' + (field.placeholder || '')
  })()`)
  check('the mission was submitted', submitted === 'clicked', submitted)
  const outcome = await cdp.eval(`(async () => {
    let sawRunning = false
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) sawRunning = true
      const marker = /completed|failed|cancelled/i.test((document.querySelector('.lc-workroom__header') || document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText)
      if (sawRunning && !stop && marker) {
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
  check('the reply is not empty', (result.reply ?? '').trim().length > 0)

  say('4. the ledger recorded a Cursor mission')
  const names = (await readdir(LEDGER_DIR).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const records = names.length === 1 ? (await readFile(join(LEDGER_DIR, names[0]), 'utf8')).split('\n').filter((l) => l).map((l) => JSON.parse(l)) : []
  const header = records[0]?.metadata
  check('one mission ledger exists', names.length === 1, `ledgers: ${names.length}`)
  // Cursor lists `composer-2.5` and `composer-2.5-fast` as separate models,
  // and the picker folds a family into one row with `fast` beside it. So the
  // id that gets recorded depends on that control, and pinning the plain id
  // failed on a run that was correct: picked Composer 2.5 with fast on, ran
  // and recorded `composer-2.5-fast` (2026-09-07).
  //
  // The check worth having is not which variant ran -- it is that the record
  // agrees with what the controls said. A recorded model the person could not
  // have read off the screen is the defect this is looking for.
  const wantsFast = (chosenState.controls ?? []).some((text) => text.trim().toLowerCase() === 'fast')
  const expected = wantsFast ? `${MODEL}-fast` : MODEL
  check(
    `it records runtime cursor and the model the controls showed (${expected})`,
    header?.runtime === 'cursor' && header?.model === expected,
    JSON.stringify({ runtime: header?.runtime, model: header?.model, controls: chosenState.controls })
  )
  const events = records.filter((r) => r.recordType === 'mission.event').map((r) => r.event)
  check('every event is signed by the Cursor normalizer', events.length > 0 && events.every((e) => e?.sourceAdapter === 'cursor'), `events: ${events.length}`)
  check('a run.completed receipt with the session id', events.some((e) => e?.type === 'run.completed' && typeof e.runtimeThreadId === 'string' && e.runtimeThreadId.length > 0))
  const started = events.find((e) => e?.type === 'run.started')
  say(`       resolved model: ${started?.payload?.evidence?.raw?.model ?? '(none)'}`)
  /*
   * THE REASONING IS KEPT, AND THIS ASSERTED THE OPPOSITE.
   *
   * It required `raw.text === '[redacted]'` -- the policy until 2026-09-15,
   * when Colin overturned it: "i feel like it gives way more insight into the
   * thinking and structure of what its doing... i wanted to sacrifice
   * nothing." The adapter changed that day; this did not, so every sweep since
   * has reported the app broken FOR DOING WHAT HE ASKED FOR. Yurt's
   * 2026-09-20 sweep called it "the clearest product red", which is what a
   * stale assertion buys: an hour of attention pointed at working code.
   *
   * WHAT IS STILL TRUE AND STILL WORTH CHECKING is the narrower promise the
   * adapter actually makes: secrets are scrubbed from reasoning exactly as
   * they are from anything else. That was measured wrong once already -- on
   * 2026-09-17 the evidence read `[redacted]` while the message text carried
   * the key verbatim -- so it is the half that has a defect history.
   *
   * No thinking at all is a PASS. A prompt this small may not produce any,
   * and requiring reasoning to exist grades the model for being brief.
   */
  const thinking = events.filter((e) => e?.payload?.evidence?.raw?.type === 'thinking')
  const leaked = thinking.filter((e) => /\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/.test(String(e?.payload?.evidence?.raw?.text ?? '')))
  check('reasoning reached the ledger readable, with no secret in it', leaked.length === 0, `thinking records: ${thinking.length}, with a secret: ${leaked.length}`)
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
say('\ncursor smoke passed')
