// Follow-up smoke: a reply continues the conversation instead of starting a
// stranger.
//
//   node _smoke/follow-up-smoke.mjs
//
// This is the bug the app's owner reported: "when I respond, instead of
// keeping that chat it opens a whole new chat". The fix is unit-tested and
// mutation-checked, but the claim that matters is the live one, so this runs
// TWO real turns through the built app on the cheapest available route
// (Cursor / composer-2.5) and requires all three of:
//
//   - the reply is recorded as a NEW mission that continues the first, with
//     reason `follow-up` and the runtime's own session id,
//   - the runtime resumed that same session rather than opening a new one,
//   - and the model actually remembers, which is the part a person sees.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9223
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const CURSOR_DIR = 'C:\\Users\\<home>\\AppData\\Local\\cursor-agent'
// Which route to prove it on. Cursor is the default because it is the
// cheapest here; the same check belongs on Codex and Claude Code, and runs
// there with `--route=codex --model="GPT-5"` when there is quota to spend.
const arg = (name, fallback) => {
  const found = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))
  return found === undefined ? fallback : found.slice(name.length + 3)
}
const ROUTE = arg('route', 'cursor')
const MODEL = arg('model', 'Composer 2.5')
// A word the model cannot get right by guessing, so a "remembered" answer in
// the second turn can only have come from the first.
const CODE = 'marmalade-quokka-71'
const FIRST = `Remember this passphrase exactly: ${CODE}. Reply with only the word ok. Do not read any files.`
const SECOND = 'What was the passphrase I gave you? Reply with only the passphrase.'

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
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve })),
      (async () => {
        for (let i = 0; i < 400; i += 1) {
          await sleep(1000)
          if (child.exitCode !== null) return { error: { message: `app exited ${child.exitCode} mid-step` } }
        }
        return { error: { message: 'cdp timeout' } }
      })()
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

const profile = await mkdtemp(join(tmpdir(), 'locust-followup-smoke-'))
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

/** Send a prompt through the composer and wait for the run to finish. */
const runTurn = (prompt) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(prompt)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  let clicked = false
  for (let i = 0; i < 120 && !clicked; i += 1) {
    await new Promise(r => setTimeout(r, 250))
    const send = document.querySelector('form.command-dock .send-button')
    if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') { send.click(); clicked = true }
  }
  if (!clicked) return JSON.stringify({ started: false, why: field.placeholder })
  let sawRunning = false
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 1000))
    const stop = document.querySelector('button[aria-label^="Stop the running"]')
    if (stop) sawRunning = true
    const marker = document.querySelector('.lc-thread__marker')
    if (sawRunning && !stop && marker) {
      return JSON.stringify({
        started: true,
        done: true,
        header: (document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText.replace(/\\s+/g, ' ').trim(),
        thread: document.querySelector('.lc-thread').innerText.replace(/\\s+/g, ' ').trim(),
        error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText.trim()
      })
    }
  }
  return JSON.stringify({ started: true, done: false })
})()`

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

  say(`2. pick the route under test (${ROUTE} / ${MODEL})`)
  const picked = await cdp.eval(`(async () => {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (!document.querySelector('.lc-picker')) control.click()
      await new Promise(r => setTimeout(r, 250))
      const picker = document.querySelector('.lc-picker')
      if (!picker) continue
      const input = picker.querySelector('.lc-picker__input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(MODEL.toLowerCase())})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 400))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        if (row && !row.disabled && new RegExp(${JSON.stringify(ROUTE)}, 'i').test(group) && row.innerText.trim().toLowerCase().startsWith(${JSON.stringify(MODEL.toLowerCase())})) {
          row.click()
          await new Promise(r => setTimeout(r, 300))
          return JSON.stringify({ picked: true, controls: [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()) })
        }
      }
    }
    return JSON.stringify({ picked: false })
  })()`)
  const pickedState = JSON.parse(picked)
  // The picker shows a display name ("Composer 2.5") and the composer shows
  // the model id ("composer-2.5"); compare on letters and digits alone.
  const plain = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  check('the route under test is selected', pickedState.picked === true && (pickedState.controls ?? []).some((t) => plain(t).includes(plain(MODEL))), picked)

  say('3. first turn: give it something only this conversation knows')
  const first = JSON.parse(await cdp.eval(runTurn(FIRST)))
  check('the first mission ran to a terminal state', first.started === true && first.done === true, JSON.stringify(first).slice(0, 200))
  check('the first mission completed', /completed/.test(first.header ?? '') && !first.error, first.error || first.header)

  say('4. second turn: a plain reply, with nothing re-selected')
  const second = JSON.parse(await cdp.eval(runTurn(SECOND)))
  check('the reply ran to a terminal state', second.started === true && second.done === true, JSON.stringify(second).slice(0, 200))
  check('the reply completed', /completed/.test(second.header ?? '') && !second.error, second.error || second.header)
  say(`       thread now: ${(second.thread ?? '').slice(-220)}`)
  check('the model remembered the passphrase', new RegExp(CODE, 'i').test(second.thread ?? ''), (second.thread ?? '').slice(-200))
  check('and the earlier turn is still on screen', (second.thread ?? '').includes('passphrase exactly'), (second.thread ?? '').slice(0, 200))

  say('5. the ledger records it as a continuation, not a stranger')
  const names = (await readdir(LEDGER_DIR).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const headers = await Promise.all(names.map(async (name) => {
    const first = (await readFile(join(LEDGER_DIR, name), 'utf8')).split('\n')[0]
    return JSON.parse(first).metadata
  }))
  headers.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  check('two missions were recorded', headers.length === 2, `${String(headers.length)} missions`)
  const [opening, reply] = headers
  say(`       opening: ${opening?.missionId} · reply continues: ${JSON.stringify(reply?.continuesFrom)}`)
  check('the reply is a separate mission', opening?.missionId !== reply?.missionId)
  check('it continues the opening mission', reply?.continuesFrom?.missionId === opening?.missionId, JSON.stringify(reply?.continuesFrom))
  check('for the stated reason: a follow-up, not a handoff', reply?.continuesFrom?.reason === 'follow-up', reply?.continuesFrom?.reason)
  check('and it names the session it resumed', typeof reply?.continuesFrom?.runtimeThreadId === 'string' && reply.continuesFrom.runtimeThreadId.length > 0, reply?.continuesFrom?.runtimeThreadId)

  // The claim above is the ledger's. This is the runtime's: both runs carry
  // the same session id, so the CLI really was resumed rather than restarted.
  const sessions = await Promise.all(names.map(async (name) => {
    const lines = (await readFile(join(LEDGER_DIR, name), 'utf8')).split('\n').filter((line) => line)
    for (const line of lines) {
      const record = JSON.parse(line)
      if (record.recordType === 'mission.event' && record.event?.type === 'run.started') {
        return record.event.runtimeThreadId ?? record.event.payload?.runtimeThreadId
      }
    }
    return undefined
  }))
  say(`       sessions: ${JSON.stringify(sessions)}`)
  check('both turns ran in one runtime session', sessions.length === 2 && sessions[0] !== undefined && sessions[0] === sessions[1], JSON.stringify(sessions))
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-2500))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\nfollow-up smoke passed')
