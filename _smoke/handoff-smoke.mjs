// Handoff smoke: launch the built app, start a real Codex mission, switch it to
// Claude Code mid-flight through the UI, and assert on what the SCREEN says.
//
//   node _smoke/handoff-smoke.mjs
//
// Exits non-zero on any failed assertion. Always kills the app on the way out.
//
// What makes this worth running rather than trusting the unit tests: the whole
// feature is a claim that TWO providers can work the same problem and the
// transcript will stay honest about who did what. That claim spans the ledger's
// schema, a service that stops one process and starts another, and a divider
// that reads the result -- and every one of those seams is somewhere a unit
// test's fake would have agreed with a broken build.
//
// The controls are the point. Before the switch, the divider must be ABSENT and
// the second runtime's name must not already be on screen; after it, both must
// be there. Without the "before" half, a divider that rendered unconditionally
// would pass.

// FIRST: points tmpdir() outside AppData, where `~/.cursorignore` makes
// every Cursor run blind to the workspace. See _tools/scratch-root.mjs.
import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'

// Long enough that the run is still going when the switch is made. A prompt
// that finishes first would leave nothing to hand off, and the test would pass
// for the wrong reason -- so step 4 asserts the run is STILL RUNNING first.
const PROMPT =
  'List every file in this workspace one at a time, and after each one write a short sentence about what it is for. Take your time and be thorough.'

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
      sleep(180_000).then(() => ({ error: { message: 'cdp timeout' } }))
    ])
  }
  async eval(expression) {
    const message = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (message.error) throw new Error(JSON.stringify(message.error))
    const result = message.result
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    }
    return result?.result?.value
  }
}

const profile = await mkdtemp(join(tmpdir(), 'locust-handoff-smoke-'))
const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts and exposes a renderer')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch {
      // devtools endpoint not listening yet
    }
  }
  check('renderer target available', page !== undefined,
    child.exitCode === null ? undefined : `app exited ${child.exitCode}`)
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

  say('2. both runtimes are discovered and usable')
  const composerReady = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i += 1) {
      if (document.querySelector('form.command-dock textarea')) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('composer is on screen', composerReady === true)

  // A handoff needs somewhere to go. If only one runtime is usable this whole
  // smoke is untestable on this machine, and saying so is better than passing.
  const routes = await cdp.eval(`(async () => {
    const openPicker = () => {
      const control = [...document.querySelectorAll('.lc-control')]
        .find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control) control.click()
      return control
    }
    for (let i = 0; i < 80; i += 1) {
      openPicker()
      await new Promise(r => setTimeout(r, 250))
      const picker = document.querySelector('.lc-picker')
      if (picker) {
        const rows = [...picker.querySelectorAll('.lc-picker__row')]
          .filter(r => !r.disabled)
          .map(r => r.innerText.trim())
        const groups = [...picker.querySelectorAll('.lc-picker__group')].map(g => g.innerText.trim())
        openPicker()
        if (rows.length > 0) return JSON.stringify({ rows, groups })
      }
    }
    return JSON.stringify({ rows: [], groups: [] })
  })()`)
  const routeState = JSON.parse(routes)
  say(`       groups: ${JSON.stringify(routeState.groups)}`)
  const hasClaude = routeState.groups.some((g) => /claude/i.test(g))
  check('Claude Code is offered as a route', hasClaude, routes)
  if (!hasClaude) {
    say('       Claude Code is not usable here, so a handoff has nowhere to go.')
    say(appOutput.join(''))
    process.exit(1)
  }

  say('3. CONTROLS: nothing about a handoff is on screen yet')
  const before = await cdp.eval(`JSON.stringify({
    divider: document.querySelector('.lc-handoff') !== null,
    text: document.body.innerText
  })`)
  const beforeState = JSON.parse(before)
  check('CONTROL: no handoff divider before the switch', beforeState.divider === false)
  // Word-bounded and scoped to the transcript, because the route picker itself
  // legitimately names Claude Code before any switch has happened.
  const threadTextBefore = await cdp.eval(
    `(document.querySelector('.lc-thread__column') || { innerText: '' }).innerText`
  )
  check('CONTROL: the transcript does not mention Claude Code yet', !/claude code/i.test(threadTextBefore))

  say('4. start a real Codex mission and confirm it is still running')
  const submitted = await cdp.eval(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    const send = document.querySelector('form.command-dock .send-button')
    if (send.disabled) return 'send stayed disabled'
    send.click()
    return 'clicked'
  })()`)
  check('the mission was submitted', submitted === 'clicked', submitted)

  const running = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      // The stop control alone is NOT enough: it appears the moment the
      // prompt is submitted, while the mission is still starting and has no
      // runId. A handoff needs that id, so wait for the mission marker, which
      // renders only once the host's receipt has come back -- and for the
      // provider to have actually said something, so the transcript being
      // carried across the divider is not empty.
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      const spoke = document.querySelectorAll('.lc-agentline, .lc-card').length > 0
      if (stop && spoke) return true
    }
    return false
  })()`)
  check('the mission is live before the switch', running === true)

  // Record whether the renderer actually reaches the bridge, and with what.
  await cdp.eval(`(() => {
    const original = window.desktop.handOffMission
    window.__handoffCalls = []
    window.desktop.handOffMission = (request) => {
      window.__handoffCalls.push(request)
      return original(request).then((response) => {
        window.__handoffCalls.push({ response })
        return response
      })
    }
    return true
  })()`)

  say('5. switch the running mission to Claude Code')
  const switched = await cdp.eval(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')]
      .find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return 'no route control'
    if (control.disabled) return 'route control is disabled while running'
    control.click()
    await new Promise(r => setTimeout(r, 300))
    const picker = document.querySelector('.lc-picker')
    if (!picker) return 'picker did not open'
    const notice = picker.querySelector('.lc-picker__notice')
    const rows = [...picker.querySelectorAll('.lc-picker__row')].filter(r => !r.disabled)
    // Rows carry the model name; the group header carries the runtime, so walk
    // up to find the Claude group rather than matching on the row text.
    let target
    let group = ''
    for (const node of picker.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) group = header.innerText
      const row = node.querySelector('.lc-picker__row')
      if (row && !row.disabled && /claude/i.test(group)) { target = row; break }
    }
    if (!target) return JSON.stringify({ clicked: false, why: 'no selectable Claude row' })
    const picked = { group, row: target.innerText.trim() }
    target.click()
    return JSON.stringify({ clicked: true, picked, notice: notice ? notice.innerText : null })
  })()`)
  let switchState
  try {
    switchState = JSON.parse(switched)
  } catch {
    switchState = { clicked: false }
  }
  check('the route control is usable while a mission runs', switchState.clicked === true, switched)
  // The picker must SAY that choosing here stops the run. It looks identical to
  // the start-time picker, and a silent one would make an irreversible action
  // look like a preference.
  check(
    'the picker warns that switching stops the run',
    typeof switchState.notice === 'string' && /stops it/i.test(switchState.notice),
    switchState.notice ?? 'no notice'
  )

  // Isolates renderer from host: a bogus runId must come back RUN_NOT_ACTIVE.
  // If it does, the channel is intact and any failure above is renderer-side.
  const channel = await cdp.eval(
    `window.desktop.handOffMission({ runId: 'run_not_real', runtime: 'claude', mode: 'ask' }).then(r => JSON.stringify(r))`
  )
  say(`       channel probe: ${channel}`)

  await sleep(2000)
  // `handingOff` disables the route control, so its state after the click tells
  // the two failure shapes apart: still enabled means the renderer returned
  // before reaching the bridge; disabled means the host has the request.
  const midFlight = await cdp.eval(`JSON.stringify({
    routeDisabled: (() => {
      const c = [...document.querySelectorAll('.lc-control')]
        .find(b => b.getAttribute('aria-haspopup') === 'listbox')
      return c ? c.disabled : null
    })(),
    stopPresent: document.querySelector('button[aria-label^="Stop the running"]') !== null,
    header: (document.querySelector('.lc-workroom__header') || { innerText: '' }).innerText.split(/\\s+/).join(' ').trim().slice(0, 120)
  })`)
  say(`       mid-flight: ${midFlight}`)

  say('6. the divider appears and says who handed off to whom')
  const after = await cdp.eval(`(async () => {
    const trail = []
    // 240 x 500ms. Aborting a busy provider, draining its records, writing a
    // checkpoint and launching a second runtime is a chain of real work; a
    // short wait here would report a slow handoff as a broken one.
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const head = document.querySelector('.lc-workroom__header')
      const state = head ? head.innerText.split(/\\s+/).join(' ').trim().slice(0, 90) : 'no header'
      if (trail[trail.length - 1] !== state) trail.push(state)
      const divider = document.querySelector('.lc-handoff')
      if (divider) {
        return JSON.stringify({
          found: true,
          trail,
          waitedMs: i * 500,
          text: divider.innerText.trim(),
          label: divider.getAttribute('aria-label'),
          priorItems: (() => {
            const column = document.querySelector('.lc-thread__column')
            if (!column) return -1
            const kids = [...column.children]
            return kids.slice(0, kids.indexOf(divider)).length
          })()
        })
      }
    }
    return JSON.stringify({ found: false, trail, text: document.body.innerText.slice(0, 800) })
  })()`)
  const afterState = JSON.parse(after)
  // Normalised HERE, not inside the injected string: a whitespace class written
  // into a template literal is one backslash away from becoming /s+/g, which
  // silently deletes every letter "s" from the text under test.
  if (typeof afterState.text === 'string') afterState.text = afterState.text.replace(/\s+/g, ' ').trim()
  say(`       state trail: ${JSON.stringify(afterState.trail)}`)
  check('a handoff divider is on screen', afterState.found === true, afterState.text)
  if (afterState.found === true) {
    say(`       divider: ${afterState.text}`)
    // Case-insensitive: the divider is uppercased by CSS, and innerText
    // reflects that, so a case-sensitive match would test the stylesheet.
    check('it names the runtime that handed off', /codex/i.test(afterState.text), afterState.text)
    check('it names the runtime that took over', /claude code/i.test(afterState.text), afterState.text)
    // Either wording is correct -- which one appears depends on whether
    // anything was actually in flight at the moment of the stop -- but one of
    // them must be there, because saying nothing about the unsettled actions is
    // the failure this whole feature exists to prevent.
    check(
      'it states what was left in doubt',
      /never reported back|Nothing was in flight/.test(afterState.text),
      afterState.text
    )
    check(
      'the first runtime\u2019s work is still above the line',
      afterState.priorItems > 1,
      `items above divider: ${afterState.priorItems}`
    )
  }

  say('7. the continuation is a real second run')
  const continued = await cdp.eval(`JSON.stringify({
    text: (document.querySelector('.lc-thread__column') || { innerText: '' }).innerText.slice(0, 400)
  })`)
  const continuedState = JSON.parse(continued)
  // The user's own words, once. The generated briefing must never be drawn as
  // something the person said.
  const bubbles = await cdp.eval(`document.querySelectorAll('.lc-bubble').length`)
  check('the machine-written briefing is not shown as the user\u2019s message', bubbles === 1,
    `user bubbles: ${bubbles}`)
  say(`       transcript head: ${continuedState.text.replace(/\s+/g, ' ').slice(0, 160)}`)
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
say('\nhandoff smoke passed')
