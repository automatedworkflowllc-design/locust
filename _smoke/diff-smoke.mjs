// Diff smoke: a real edit, by a real runtime, read back off the screen.
//
//   node _smoke/diff-smoke.mjs
//
// The diff view exists because the app used to record a change and show only
// a filename. So this smoke refuses to trust anything but the rendered rows:
// it makes a throwaway workspace, has Cursor Agent edit one file in it under
// Accept edits, and then asserts against the DOM that
//
//   * the activity card carries `+N -M`,
//   * the file row names the file, its status, and its own counts,
//   * the unified rows are really there, with signs as well as fills,
//   * the header total equals the sum of the file rows -- the derived-counts
//     rule, checked on screen rather than in a unit test, and
//   * the open file ends in a completeness statement rather than silence.
//
// The last two are the two rules the design pass asked to be enforced in
// code; a unit test proves the functions, this proves what a person sees.
// Needs a signed-in cursor-agent. Cheap: one short edit on composer-2.5.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9231
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const CURSOR_DIR = 'C:\\Users\\<home>\\AppData\\Local\\cursor-agent'
const TARGET = 'notes.ts'
const PROMPT = `Edit ${TARGET}: change the word "draft" to "final" on the line that has it, and add one new line at the end that reads // reviewed. Change nothing else and do not create any other file.`

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

const profile = await mkdtemp(join(tmpdir(), 'locust-diff-smoke-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-diff-work-'))
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
    settings: { swarm: false }
  })
)

// The mission workspace is the app's own working directory, so the throwaway
// folder becomes the workspace by launching there.
const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${CURSOR_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts in the throwaway workspace')
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
  await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  say('2. wait for discovery, then pick Cursor Agent / Composer 2.5 and Accept edits')
  const discovered = await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control && /cursor|codex|claude/i.test(control.innerText)) return control.innerText.replace(/\\s+/g, ' ').trim()
      await new Promise(r => setTimeout(r, 500))
    }
    return ''
  })()`)
  check('discovery named a route before the picker opened', discovered.length > 0, JSON.stringify(discovered))

  const setup = await cdp.eval(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    control.click()
    await new Promise(r => setTimeout(r, 400))
    const picker = document.querySelector('.lc-picker')
    if (!picker) return JSON.stringify({ picked: false, why: 'no picker' })
    // Each runtime's group is capped, so a model outside the first few is
    // reached the way a person reaches it: by typing.
    const input = picker.querySelector('.lc-picker__input')
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(input, 'composer 2.5')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    let group = ''
    let target
    for (const node of picker.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) group = header.innerText
      const row = node.querySelector('.lc-picker__row')
      const label = row ? row.innerText.trim().toLowerCase() : ''
      if (row && !row.disabled && /cursor/i.test(group) && label.startsWith('composer 2.5')) { target = row; break }
    }
    if (!target) return JSON.stringify({ picked: false, why: 'no composer row after search', rows: [...picker.querySelectorAll('.lc-picker__row')].map(r => r.innerText).slice(0, 12) })
    target.click()
    await new Promise(r => setTimeout(r, 400))
    const modeControl = [...document.querySelectorAll('.lc-control')].find(b => /ask|accept|approve/i.test(b.innerText))
    if (!modeControl) return JSON.stringify({ picked: true, mode: 'no mode control' })
    modeControl.click()
    await new Promise(r => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role="menuitem"], .lc-menu__item, button')].find(b => /accept edits/i.test(b.innerText) && !b.disabled)
    if (item) item.click()
    await new Promise(r => setTimeout(r, 400))
    return JSON.stringify({
      picked: true,
      controls: [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())
    })
  })()`)
  const chosen = JSON.parse(setup)
  check('Composer 2.5 was selectable under Cursor Agent', chosen.picked === true, setup)
  say(`       controls: ${JSON.stringify(chosen.controls)}`)
  check('the mode control reads Accept edits', (chosen.controls ?? []).some((text) => /accept edits/i.test(text)), JSON.stringify(chosen.controls))

  say('3. run one real edit')
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
  const finished = await cdp.eval(`(async () => {
    let sawRunning = false
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) sawRunning = true
      const marker = document.querySelector('.lc-thread__marker')
      if (sawRunning && !stop && marker) return JSON.stringify({ done: true, error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText })
    }
    return JSON.stringify({ done: false })
  })()`)
  const done = JSON.parse(finished)
  check('the run reached a terminal state', done.done === true)
  if (done.error) say(`       error card: ${done.error.replace(/\s+/g, ' ').slice(0, 240)}`)

  const after = await readFile(join(workspace, TARGET), 'utf8').catch(() => '')
  check('the file on disk really changed', /final/.test(after) && /reviewed/.test(after), JSON.stringify(after).slice(0, 200))

  say('4. the change is on screen, and it reads as one change')
  const view = await cdp.eval(`(async () => {
    const card = [...document.querySelectorAll('.lc-activity')].pop()
    if (!card) return JSON.stringify({ card: false })
    if (card.getAttribute('aria-expanded') !== 'true') card.click()
    await new Promise(r => setTimeout(r, 400))
    const list = card.parentElement.querySelector('.lc-activity__list')
    const num = (node) => node ? Number(node.innerText.replace(/[^0-9]/g, '')) : null
    const rows = [...(list ? list.querySelectorAll('.lc-filerow') : [])].map(row => ({
      path: (row.querySelector('.lc-filerow__path') || {}).innerText,
      status: (row.querySelector('.lc-filerow__status') || {}).innerText,
      added: num(row.querySelector('.lc-diff__addmark')),
      removed: num(row.querySelector('.lc-diff__delmark')),
      text: row.innerText.replace(/\\s+/g, ' ').trim()
    }))
    const openFile = [...(list ? list.querySelectorAll('.lc-filerow') : [])].find(r => r.getAttribute('aria-expanded') === 'true')
    if (rows.length > 0 && !openFile) {
      const first = list.querySelector('.lc-filerow')
      if (first) { first.click(); await new Promise(r => setTimeout(r, 300)) }
    }
    const diff = list ? list.querySelector('.lc-diff') : null
    return JSON.stringify({
      card: true,
      headerAdded: num(card.querySelector('.lc-diff__addmark')),
      headerRemoved: num(card.querySelector('.lc-diff__delmark')),
      summary: card.innerText.replace(/\\s+/g, ' ').trim(),
      rows,
      hunk: diff ? (diff.querySelector('.lc-diff__hunk') || { innerText: '' }).innerText.trim() : null,
      signs: diff ? [...diff.querySelectorAll('.lc-diff__row')].map(r => (r.querySelector('.lc-diff__sign') || {}).innerText) : [],
      addRows: diff ? diff.querySelectorAll('.lc-diff__row.is-add').length : 0,
      delRows: diff ? diff.querySelectorAll('.lc-diff__row.is-del').length : 0,
      marked: diff ? diff.querySelectorAll('.lc-diff__word').length : 0,
      gutterUnselectable: diff ? getComputedStyle(diff.querySelector('.lc-diff__no')).userSelect : null,
      foot: diff ? (diff.querySelector('.lc-diff__foot') || { innerText: '' }).innerText.trim() : null
    })
  })()`)
  const shown = JSON.parse(view)
  check('an activity card is present', shown.card === true, view)
  say(`       summary: ${shown.summary}`)
  say(`       file rows: ${JSON.stringify(shown.rows)}`)
  say(`       hunk: ${shown.hunk} · foot: ${shown.foot}`)
  const files = (shown.rows ?? []).filter((row) => row.added !== null)
  check(
    'a file row names the edited file with its status',
    files.some((row) => (row.path ?? '').includes(TARGET) && /MODIFIED/.test(row.status ?? '')),
    JSON.stringify(files)
  )
  check('the file row carries its own counts', files.some((row) => (row.added ?? 0) > 0))
  check('the diff rendered unified rows', (shown.addRows ?? 0) > 0 && (shown.delRows ?? 0) > 0, `+${shown.addRows} / -${shown.delRows}`)
  check('every changed row carries a sign, not colour alone', (shown.signs ?? []).filter((sign) => sign === '+' || sign === '−').length === (shown.addRows ?? 0) + (shown.delRows ?? 0), JSON.stringify(shown.signs))
  check('a hunk header states its derived range', /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(shown.hunk ?? ''), shown.hunk)
  check('the changed span inside a line is marked', (shown.marked ?? 0) > 0, `marked spans: ${shown.marked}`)
  check('line numbers cannot be selected into a copy', shown.gutterUnselectable === 'none', shown.gutterUnselectable)

  // The two rules, checked against what is actually painted.
  const sumAdded = files.reduce((total, row) => total + (row.added ?? 0), 0)
  const sumRemoved = files.reduce((total, row) => total + (row.removed ?? 0), 0)
  check(
    'the card total equals the sum of its file rows',
    shown.headerAdded === sumAdded && shown.headerRemoved === sumRemoved,
    `card +${shown.headerAdded} -${shown.headerRemoved} vs rows +${sumAdded} -${sumRemoved}`
  )
  check('the open file ends in a completeness statement, not silence', typeof shown.foot === 'string' && shown.foot.length > 0, JSON.stringify(shown.foot))
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

console.error(failures === 0 ? '\nDIFF SMOKE PASSED' : `\n${failures} DIFF SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
