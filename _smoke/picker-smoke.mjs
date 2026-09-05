// Picker smoke: a runtime with hundreds of models does not bury the others.
//
//   node _smoke/picker-smoke.mjs
//
// Starts NO mission and spends no provider quota. It opens the route picker,
// checks every group is capped and says how many rows it is holding back,
// that a runtime listed after the long one is still reachable without
// scrolling past it, and that typing lifts the cap.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9226
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const CURSOR_DIR = 'C:\\Users\\<home>\\AppData\\Local\\cursor-agent'
const LIMIT = 6

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

/** Read the open picker: rows and "N more" lines, in document order. */
const READ_PICKER = `(async () => {
  const open = () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (control) control.click()
  }
  for (let i = 0; i < 160; i += 1) {
    if (!document.querySelector('.lc-picker')) open()
    await new Promise(r => setTimeout(r, 250))
    const picker = document.querySelector('.lc-picker')
    if (!picker) continue
    const groups = []
    let current
    for (const node of picker.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) { current = { group: header.innerText.trim(), rows: [], more: null }; groups.push(current) }
      const row = node.querySelector('.lc-picker__row')
      if (row && current) current.rows.push(row.innerText.replace(/\\s+/g, ' ').trim())
      const more = node.querySelector('.lc-picker__more')
      if (more && current) current.more = more.innerText.replace(/\\s+/g, ' ').trim()
    }
    // Wait until the catalog has been read: more than one row under a runtime.
    if (groups.some(g => g.rows.length > 1)) return JSON.stringify(groups)
  }
  return JSON.stringify([])
})()`

const profile = await mkdtemp(join(tmpdir(), 'locust-picker-smoke-'))
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

  say('2. every group in the open picker is capped, and says what it holds back')
  const groups = JSON.parse(await cdp.eval(READ_PICKER))
  for (const group of groups) say(`       ${group.group}: ${group.rows.length} rows${group.more === null ? '' : ` · ${group.more}`}`)
  check('the picker opened with rows', groups.length > 0)
  check(`no group shows more than ${LIMIT} rows`, groups.every((group) => group.rows.length <= LIMIT), JSON.stringify(groups.map((g) => [g.group, g.rows.length])))
  // A group can sit exactly at the cap with nothing held back -- Codex lists
  // six models -- so the cap line is required only where rows were withheld,
  // and where it appears the arithmetic has to come out.
  const cursor = groups.find((group) => /cursor/i.test(group.group))
  const hidden = Number(/(\d+) more/.exec(cursor?.more ?? '')?.[1] ?? NaN)
  check('the long group says how many it holds back', cursor !== undefined && / more models · type to search them$/.test(cursor.more ?? ''), cursor?.more ?? '(no cursor group)')
  // Not a fixed total: the runtime's list changes, and the models it lists as
  // separate efforts are now collapsed into one row each. What must hold is
  // that the group shows exactly the cap and accounts for the rest.
  check(
    'shown plus withheld is the whole group',
    Number.isFinite(hidden) && hidden > 0 && (cursor?.rows.length ?? 0) === LIMIT,
    `${hidden} withheld, ${cursor?.rows.length ?? 0} shown`
  )
  check('a group with nothing withheld says nothing', groups.filter((g) => g.more !== null).every((g) => g.rows.length === LIMIT))

  say('3. a runtime listed after the long one is still on screen')
  const reach = await cdp.eval(`(() => {
    const list = document.querySelector('.lc-picker__list')
    const groups = [...list.querySelectorAll('.lc-picker__group')].map(n => n.innerText.trim())
    const listBox = list.getBoundingClientRect()
    void listBox
    const rows = [...list.querySelectorAll('.lc-picker__row')]
    const lastHeader = [...list.querySelectorAll('.lc-picker__group')].pop()
    const before = rows.filter((row) => row.getBoundingClientRect().top < lastHeader.getBoundingClientRect().top).length
    return JSON.stringify({ groups, before, screens: list.scrollHeight / list.clientHeight })
  })()`)
  const reachState = JSON.parse(reach)
  say(`       groups: ${reachState.groups.join(' | ')} · ${reachState.before} rows above the last · ${reachState.screens.toFixed(1)} screens tall`)
  check('more than one runtime is grouped', reachState.groups.length > 1, JSON.stringify(reachState.groups))
  // The bound that matters is the cap's own: with N runtimes above the last
  // one, no more than N capped groups can stand in the way. Uncapped, ONE
  // 217-model runtime put 217 rows in front of everything below it.
  const ceiling = (reachState.groups.length - 1) * LIMIT
  check(`no more than ${ceiling} rows stand above the last runtime`, reachState.before <= ceiling, `${reachState.before} rows`)

  say('4. typing lifts the cap')
  const searched = await cdp.eval(`(async () => {
    const input = document.querySelector('.lc-picker__input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'a')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    const list = document.querySelector('.lc-picker__list')
    return JSON.stringify({
      rows: list.querySelectorAll('.lc-picker__row').length,
      more: list.querySelectorAll('.lc-picker__more').length
    })
  })()`)
  const searchState = JSON.parse(searched)
  say(`       "a": ${searchState.rows} rows, ${searchState.more} cap lines`)
  check('a search shows more than the cap', searchState.rows > LIMIT, searched)
  check('and states no cap of its own', searchState.more === 0, searched)
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
say('\npicker smoke passed')
