// Can you say the next thing while a teammate works, and plan before doing?
//
//   node _smoke/steering-smoke.mjs [--keep]
//
// Two behaviours in one live run, because both are composer work on the same
// screen and both are asserted from the durable record:
//
//   1. QUEUED STEERING -- type while a mission is running. The box stays
//      usable, the text waits, and it goes as the NEXT TURN of that same
//      conversation once the run completes.
//   2. PLAN FIRST -- a read-only run told to answer with the steps it would
//      take. The thread then offers "Build this plan", and pressing it starts
//      an accept-edits turn of the same conversation.

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
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const PORT = portFor(import.meta.url)
const KEEP = process.argv.includes('--keep')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => console.error(line)

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) say(`  [PASS] ${label}${detail ? ` -- ${detail}` : ''}`)
  else {
    failures += 1
    say(`  [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`)
  }
}

const profile = await mkdtemp(join(tmpdir(), 'locust-steer-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-steer-ws-'))
await mkdir(profile, { recursive: true })
await writeFile(join(workspace, 'status.ts'), 'export const status = "draft";\n', 'utf8')

// Refuse to start if something already answers on this port. Two of these
// running at once both bind the SAME debugging port: the second one loses the
// bind, silently drives the FIRST app, and then hangs forever when that app is
// killed -- which is exactly what happened on 2026-09-05 and looked like the
// product wedging. A port already in use is an operator error, said out loud.
try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)} -- close the other smoke first`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', () => undefined)
child.stderr.on('data', () => undefined)

const ledgerDir = join(profile, 'mission-ledger')
const headers = async () => {
  let names = []
  try {
    names = (await readdir(ledgerDir)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    const first = (await readFile(join(ledgerDir, name), 'utf8')).split('\n')[0] ?? '{}'
    try {
      out.push(JSON.parse(first).metadata ?? {})
    } catch {
      /* a partial write mid-read is not a finding */
    }
  }
  return out
}

try {
  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up */ }
  }
  if (page === undefined) throw new Error('renderer never came up')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true })
    socket.addEventListener('error', rej, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const evaluate = (expression) =>
    new Promise((resolve_) => {
      const next = ++id
      // A dead renderer never answers, and an await with no timeout then hangs
      // the whole run with no output at all. Say so and carry on failing.
      const gaveUp = setTimeout(() => {
        if (pending.delete(next)) {
          say('  eval timed out: the app stopped answering')
          resolve_(undefined)
        }
      }, 600_000)
      pending.set(next, (message) => {
        clearTimeout(gaveUp)
        const thrown = message.result?.exceptionDetails
        if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? ''}`.slice(0, 300))
        resolve_(message.result?.result?.value)
      })
      socket.send(JSON.stringify({ id: next, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })

  say('1. the app starts on the cheap route')
  await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  const routed = await evaluate(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    control.click()
    await new Promise(r => setTimeout(r, 400))
    let target
    for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      const box = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, 'composer 2.5')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        const label = row ? row.innerText.trim().toLowerCase() : ''
        if (row && !row.disabled && /cursor/i.test(group) && label.startsWith('composer 2.5')) { target = row; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return 'composer 2.5 not offered'
    target.click()
    await new Promise(r => setTimeout(r, 400))
    return document.querySelector('.lc-control[aria-haspopup=listbox]').innerText.replace(/\\s+/g, ' ')
  })()`)
  check('on Cursor / composer-2.5', /cursor/i.test(String(routed)), String(routed))

  const type = (text) => evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    if (field.disabled) return 'the box is disabled'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    return 'typed'
  })()`)
  const clickSend = (label) => evaluate(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]')
      if (button && !button.disabled) { button.click(); return 'clicked' }
      await new Promise(r => setTimeout(r, 250))
    }
    return 'never enabled'
  })()`)
  const settle = (seconds) => evaluate(`(async () => {
    for (let i = 0; i < ${String(seconds * 2)}; i += 1) {
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  })()`)

  say('2. start a slow-enough run, then type while it works')
  await type('Reply with exactly the word ALPHA and nothing else.')
  check('the first mission started', (await clickSend('Start mission')) === 'clicked')
  // While it runs the box must accept text -- that is the whole feature.
  const whileRunning = await evaluate(`(async () => {
    for (let i = 0; i < 60; i += 1) {
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      const field = document.querySelector('form.command-dock textarea')
      if (stop && field) {
        return JSON.stringify({ running: true, disabled: field.disabled, placeholder: field.placeholder })
      }
      await new Promise(r => setTimeout(r, 250))
    }
    return JSON.stringify({ running: false })
  })()`)
  let seen = {}
  try { seen = JSON.parse(String(whileRunning)) } catch { /* reported below */ }
  check('the box is usable while the mission runs', seen.running === true && seen.disabled === false, String(whileRunning).slice(0, 160))
  check('and says what will happen to what you type', /goes to|when this finishes/i.test(String(seen.placeholder ?? '')), String(seen.placeholder ?? '').slice(0, 90))

  const queued = await evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    if (!field || field.disabled) return 'box unusable'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word BETA and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const button = document.querySelector('button[aria-label="Send this when the mission finishes"]')
    if (!button) return 'no queue button'
    button.click()
    await new Promise(r => setTimeout(r, 400))
    const chip = document.querySelector('.lc-queued')
    return chip ? chip.innerText.replace(/\\s+/g, ' ') : 'no chip'
  })()`)
  check('it is held, and the screen says so', /BETA/.test(String(queued)) && /finishes/i.test(String(queued)), String(queued).slice(0, 140))
  // Fixing one word must not mean retyping the sentence from memory: while a
  // message is queued the box is disabled, so Discard was the only way back
  // to the text (design pass, gap 2).
  check('the queued message can be edited, not only discarded', /Edit/.test(String(queued)), String(queued).slice(0, 140))

  say('3. it goes on its own when the run finishes')
  check('the first run finished', (await settle(300)) === true)
  const arrived = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const bubbles = [...document.querySelectorAll('.lc-bubble')].map(n => n.innerText)
      if (bubbles.some(t => /BETA/.test(t))) return 'sent'
      await new Promise(r => setTimeout(r, 500))
    }
    return 'never sent'
  })()`)
  // Only 'sent' passes. The first version also accepted "the chip is gone",
  // which is what an EMPTY queue looks like -- so it passed on a run where
  // nothing had been queued at all.
  check('the queued message became the next turn', arrived === 'sent', String(arrived))
  await settle(300)
  const afterQueue = await headers()
  check('two missions, and the second continues the first', afterQueue.length === 2 && afterQueue.some((h) => h.continuesFrom?.reason === 'follow-up'), `${String(afterQueue.length)} ledgers`)
  check('the queued words are its own prompt', afterQueue.some((h) => /BETA/.test(String(h.prompt))), JSON.stringify(afterQueue.map((h) => String(h.prompt).slice(0, 24))))

  say('4. plan first, then build -- on a route that CAN be held read-only')
  // Cursor Agent has no sandbox on Windows, so neither Ask nor Plan is
  // offered there -- correctly, since a plan that could edit the workspace is
  // a promise the app cannot keep. Claude Code can be held read-only here, so
  // the plan half runs on it (steering smoke run 3).
  const switched = await evaluate(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    control.click()
    await new Promise(r => setTimeout(r, 400))
    let target
    for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      const box = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, 'sonnet')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        const label = row ? row.innerText.trim().toLowerCase() : ''
        if (row && !row.disabled && /claude/i.test(group) && label.startsWith('sonnet')) { target = row; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return 'sonnet not offered'
    target.click()
    await new Promise(r => setTimeout(r, 500))
    return document.querySelector('.lc-control[aria-haspopup=listbox]').innerText.split('\\n').join(' ')
  })()`)
  check('moved to Claude Code / sonnet for the plan half', /claude/i.test(String(switched)), String(switched))

  const planned = await evaluate(`(async () => {
    // Plan is the fourth PERMISSION MODE as of 0.21.0, not a switch beside
    // one. The menu's items are menuitemradio, not plain buttons -- an
    // earlier version of this walk queried buttons, found nothing, left the
    // mode alone and then reported the app's correct refusal as a defect.
    const modeControl = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'menu')
    if (!modeControl) return 'no mode control'
    modeControl.click()
    await new Promise(r => setTimeout(r, 400))
    const items = [...document.querySelectorAll('[role=menuitemradio]')]
    const plan = items.find(b => /^Plan/.test(b.innerText.trim()))
    if (!plan) return 'no Plan item · saw: ' + items.map(b => b.innerText.trim().slice(0, 24)).join(', ')
    if (plan.disabled) return 'Plan is unavailable on this route: ' + plan.getAttribute('title')
    plan.click()
    await new Promise(r => setTimeout(r, 500))
    return modeControl.innerText.trim()
  })()`)
  check('Plan is chosen from the mode menu', /^Plan/.test(String(planned)), String(planned))

  await type('Add a second exported constant to status.ts called reviewed.')
  check('the plan mission started', (await clickSend('Start mission')) === 'clicked')
  check('the plan run finished', (await settle(300)) === true)

  const offer = await evaluate(`(async () => {
    for (let i = 0; i < 60; i += 1) {
      const rerun = document.querySelector('.lc-rerun')
      if (rerun) return rerun.innerText.replace(/\\s+/g, ' ')
      await new Promise(r => setTimeout(r, 500))
    }
    return 'no offer'
  })()`)
  check('the thread says it planned and offers to build it', /plan, not the work/i.test(String(offer)) && /Build this plan/.test(String(offer)), String(offer).slice(0, 160))

  const planHeaders = await headers()
  const planMission = planHeaders.find((h) => /reviewed/.test(String(h.prompt)))
  check('the plan run was read-only', planMission?.sandbox === 'read-only', JSON.stringify({ sandbox: planMission?.sandbox }))
  const untouched = await readFile(join(workspace, 'status.ts'), 'utf8')
  check('and it changed nothing in the workspace', !/reviewed/.test(untouched), JSON.stringify(untouched.slice(0, 60)))

  say('5. build it')
  const built = await evaluate(`(async () => {
    const button = [...document.querySelectorAll('.lc-rerun button')].find(b => /Build this plan/.test(b.innerText))
    if (!button) return 'no build button'
    button.click()
    await new Promise(r => setTimeout(r, 1500))
    return 'clicked'
  })()`)
  check('Build this plan started a turn', built === 'clicked', String(built))
  await settle(420)
  const finalHeaders = await headers()
  /*
   * The NEWEST write-capable turn, not whichever one readdir happened to
   * yield first.
   *
   * Mission files are named by a uuid, so the directory order has nothing to
   * do with the order the turns ran in. This smoke makes more than one
   * workspace-write mission, so `find` returned an arbitrary one -- about
   * half the time an earlier turn that legitimately continues nothing -- and
   * the assertion went red with no product involvement. Measured 2026-09-11:
   * PASS, FAIL, FAIL, PASS on an unchanged build, while a trace compiled into
   * the renderer showed it sending `followUpOf` on every one of those runs.
   */
  const building = finalHeaders
    .filter((h) => h.sandbox === 'workspace-write')
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    .at(-1)
  check('the build turn may write, and continues the plan', building !== undefined && building.continuesFrom?.reason === 'follow-up', JSON.stringify({ sandbox: building?.sandbox, follows: building?.continuesFrom?.reason }))
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1500)
  if (KEEP) say(`profile kept at ${profile}; workspace at ${workspace}`)
  else {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}

if (failures > 0) {
  say(`\n${String(failures)} STEERING SMOKE FAILURE(S)`)
  process.exit(1)
}
say('\nSTEERING SMOKE PASSED')
