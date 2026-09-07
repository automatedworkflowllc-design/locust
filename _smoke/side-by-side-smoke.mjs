// Side-by-side smoke: two seeded teammates run real Codex missions at the same
// time, the person switches between their threads while both are live, and
// both finish with their own receipts.
//
//   node _smoke/side-by-side-smoke.mjs
//
// The controls: a teammate who is already working cannot be handed a second
// mission (the composer says so), and switching threads mid-run must not lose
// either run's events -- each thread still shows its own prompt and, when it
// finishes, its own completion.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9226
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'

// Long enough to still be running when the second mission starts.
const ATLAS_PROMPT =
  'List every file under apps/desktop/src one at a time, and after each one write a short sentence about what it is for. Take your time and be thorough.'
const WREN_PROMPT = 'Reply with exactly one line: "Wren here." Do not read any files and do not run anything.'

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
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    }
    return result?.result?.value
  }
}

const profile = await mkdtemp(join(tmpdir(), 'locust-side-by-side-smoke-'))
await mkdir(profile, { recursive: true })
const createdAt = new Date().toISOString()
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt },
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt }
    ],
    missionOwners: {},
    settings: { swarm: false }
  }, null, 2)
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

async function ledgers() {
  let names = []
  try {
    names = (await readdir(LEDGER_DIR)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    const records = (await readFile(join(LEDGER_DIR, name), 'utf8')).split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l))
    out.push({ missionId: name.slice(0, -'.jsonl'.length), records })
  }
  return out
}

const typeInto = (prompt) => `(() => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(prompt)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return field.placeholder
})()`

const submit = (prompt) => `(async () => {
  ${typeInto(prompt)}
  for (let i = 0; i < 120; i += 1) {
    await new Promise(r => setTimeout(r, 250))
    const send = document.querySelector('form.command-dock .send-button')
    if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') {
      send.click()
      return 'clicked'
    }
  }
  const send = document.querySelector('form.command-dock .send-button')
  return 'send stayed disabled: ' + (document.querySelector('form.command-dock textarea') || { placeholder: '' }).placeholder
})()`

const selectTeammate = (name) => `(async () => {
  const row = [...document.querySelectorAll('.lc-row--button')].find(b => b.title === 'Message ${name}')
  if (!row) return 'no row'
  row.click()
  await new Promise(r => setTimeout(r, 300))
  const field = document.querySelector('form.command-dock textarea')
  return field ? field.placeholder : 'no composer'
})()`

const screenState = `JSON.stringify({
  running: (document.querySelector('.lc-runstate') || { innerText: '' }).innerText.trim(),
  bubble: (document.querySelector('.lc-bubble') || { innerText: '' }).innerText,
  stop: document.querySelector('button[aria-label^="Stop the running"]') !== null,
  rows: [...document.querySelectorAll('.lc-teammate')].map(t => ({
    name: (t.querySelector('.lc-row__name') || { innerText: '' }).innerText.trim(),
    meta: (t.querySelector('.lc-row__meta') || { innerText: '' }).innerText.trim(),
    missions: [...t.querySelectorAll('.lc-teammate__mission')].map(m => m.innerText.trim())
  })),
  placeholder: (document.querySelector('form.command-dock textarea') || { placeholder: '' }).placeholder
})`

try {
  say('1. the app starts with two teammates')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // devtools endpoint not listening yet
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
      if (field && document.querySelectorAll('.lc-row--button').length >= 2 && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  say('2. Atlas starts a long mission')
  await cdp.eval(selectTeammate('Atlas'))
  check('Atlas\u2019s mission was submitted', (await cdp.eval(submit(ATLAS_PROMPT))) === 'clicked')
  const atlasLive = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (document.querySelector('.lc-workroom__mission, .lc-workroom__header') && document.querySelector('button[aria-label^="Stop the running"]')) return true
    }
    return false
  })()`)
  check('Atlas\u2019s run is live with a receipt', atlasLive === true)

  say('3. CONTROL: Atlas cannot be handed a second mission while working')
  const atlasBusy = await cdp.eval(typeInto('a second mission for Atlas'))
  // 0.20.0 changed what a busy composer says, and it is now the stronger
  // claim: not "you cannot", but "this waits and goes next". The control the
  // step exists for is unchanged and asserted below -- no START button.
  check(
    'the composer says what happens to a message typed while Atlas works',
    /goes to Atlas when this finishes/.test(atlasBusy),
    atlasBusy
  )
  const sendDisabled = await cdp.eval(`(document.querySelector('form.command-dock .send-button') || {}).disabled === true || document.querySelector('form.command-dock .send-button').getAttribute('aria-label') !== 'Start mission'`)
  check('and offers no start control for it', sendDisabled === true)
  await cdp.eval(typeInto(''))

  say('4. Wren starts a mission while Atlas is still running')
  const wrenPlaceholder = await cdp.eval(selectTeammate('Wren'))
  check('addressing Wren shows their idle state and an open composer', /Message Wren/.test(wrenPlaceholder), wrenPlaceholder)
  check('Wren\u2019s mission was submitted', (await cdp.eval(submit(WREN_PROMPT))) === 'clicked')
  const both = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const state = ${screenState}
      const parsed = JSON.parse(state)
      if (/2 running/.test(parsed.running)) return state
    }
    return ${screenState}
  })()`)
  const bothState = JSON.parse(both)
  check('the title bar counts two running missions', /2 running/.test(bothState.running), bothState.running)
  const atlasRow = bothState.rows.find((row) => row.name.startsWith('Atlas'))
  const wrenRow = bothState.rows.find((row) => row.name.startsWith('Wren'))
  // `working` and `thinking` are both live states; 0.18.x split them so a
  // bobbing face could not sit beside dots that mean waiting. Either proves
  // the row is showing a live run, which is what this step is about.
  check('the sidebar shows Atlas live', /working|thinking/.test(atlasRow?.meta ?? ''), atlasRow?.meta)
  check('the sidebar files a mission under each teammate', (atlasRow?.missions.length ?? 0) >= 1 && (wrenRow?.missions.length ?? 0) >= 1,
    JSON.stringify(bothState.rows))
  check('Wren\u2019s thread is on screen', bothState.bubble.trim() === WREN_PROMPT, bothState.bubble.slice(0, 60))

  say('5. switch to Atlas\u2019s thread while both are live')
  const switched = await cdp.eval(`(async () => {
    const row = [...document.querySelectorAll('.lc-teammate__mission')].find(m => m.innerText.includes('List every file'))
    if (!row) return JSON.stringify({ found: false })
    row.click()
    await new Promise(r => setTimeout(r, 400))
    const state = JSON.parse(${screenState})
    return JSON.stringify({ found: true, ...state, agentItems: document.querySelectorAll('.lc-agentline, .lc-card').length })
  })()`)
  const switchedState = JSON.parse(switched)
  check('Atlas\u2019s row is clickable while running', switchedState.found === true)
  if (switchedState.found) {
    check('Atlas\u2019s thread shows Atlas\u2019s prompt', switchedState.bubble.trim() === ATLAS_PROMPT, switchedState.bubble.slice(0, 60))
    check('and its stop control, because it is still live', switchedState.stop === true)
    check('the count is still two', /2 running/.test(switchedState.running), switchedState.running)
  }

  say('6. both finish with their own receipts')
  const finished = await cdp.eval(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const state = JSON.parse(${screenState})
      if (state.running === '') return JSON.stringify({ done: true, waitedMs: i * 1000, rows: state.rows })
    }
    return JSON.stringify({ done: false })
  })()`)
  const finishedState = JSON.parse(finished)
  check('no mission is running any more', finishedState.done === true, JSON.stringify(finishedState))
  const all = await ledgers()
  check('two mission ledgers exist', all.length === 2, `ledgers: ${all.length}`)
  const completedCount = all.filter((entry) => entry.records.some((r) => r.recordType === 'mission.event' && r.event.type === 'run.completed')).length
  // What each run actually ENDED with. "completed: 1" says a run did not
  // finish; it does not say whether it failed, was cancelled, or simply
  // stopped emitting -- which are three different bugs.
  const endings = all.map((entry) => {
    const terminal = entry.records
      .filter((r) => r.recordType === 'mission.event' && /^run\.(completed|failed|cancelled)$/.test(r.event.type ?? ''))
      .map((r) => r.event.type)
    const reason = entry.records
      .map((r) => (r.recordType === 'mission.event' ? r.event.message ?? r.event.reason : undefined))
      .filter((text) => typeof text === 'string')
      .at(-1)
    const failed = entry.records.find((r) => r.recordType === 'mission.event' && r.event.type === 'run.failed')
    if (failed !== undefined) return 'run.failed :: ' + JSON.stringify(failed.event).slice(-360)
    return (terminal.at(-1) ?? 'NO TERMINAL EVENT') + (reason === undefined ? '' : ' :: ' + String(reason).slice(0, 90))
  })
  check('both ledgers end in run.completed', completedCount === 2, `completed: ${completedCount} || ${endings.join('  ;;  ')}`)
  const roster = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8'))
  const owners = new Set(Object.values(roster.missionOwners))
  check('each mission is recorded as its teammate\u2019s', owners.has('tm_atlas') && owners.has('tm_wren'), JSON.stringify(roster.missionOwners))
  const wrenThread = await cdp.eval(`(async () => {
    const row = [...document.querySelectorAll('.lc-teammate__mission')].find(m => m.innerText.includes('Reply with exactly'))
    if (!row) return ''
    row.click()
    await new Promise(r => setTimeout(r, 400))
    return [...document.querySelectorAll('.lc-agentline')].map(n => n.innerText).join(' ')
  })()`)
  check('Wren\u2019s finished thread still holds Wren\u2019s answer after the switching', /Wren here/i.test(wrenThread), wrenThread.slice(0, 80))
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
say('\nside-by-side smoke passed')
