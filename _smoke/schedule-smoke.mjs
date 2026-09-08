// Does a scheduled routine start on its own?
//
//   node _smoke/schedule-smoke.mjs [--keep]
//
// The live proof for scheduled routines: launch the BUILT app in a throwaway
// profile, make a teammate on the cheap route (Cursor / composer-2.5), run one
// turn, save it as a routine with "Every few hours" chosen in the dialog, and
// read the schedule off the Team screen. Then QUIT, back-date the routine on
// disk five hours, relaunch the same profile, and press nothing: within the
// first tick a NEW mission must appear in the ledger recorded as started by
// the routine. After it runs, a further tick must NOT start it again.
//
// Asserted from the DURABLE RECORD: a routine that "ran" and left no ledger
// did not run, and one that ran twice in a minute is a storm, not a schedule.

// FIRST: points tmpdir() outside AppData, where `~/.cursorignore` makes
// every Cursor run blind to the workspace. See _tools/scratch-root.mjs.
import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const PORT = 9299
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

const profile = await mkdtemp(join(tmpdir(), 'locust-schedule-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-schedule-ws-'))
await mkdir(profile, { recursive: true })
await writeFile(join(workspace, 'README.md'), '# scratch\n', 'utf8')

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)} -- close the other smoke first`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const ledgerDir = join(profile, 'mission-ledger')
const ledgers = async () => {
  try {
    return (await readdir(ledgerDir)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
}
const headers = async () => {
  const out = []
  for (const name of await ledgers()) {
    const first = (await readFile(join(ledgerDir, name), 'utf8')).split('\n')[0] ?? '{}'
    try {
      out.push(JSON.parse(first).metadata ?? {})
    } catch {
      /* a partial write mid-read is not a finding */
    }
  }
  return out
}

/** Launch the app on this profile and hand back a CDP evaluate plus a stop. */
async function launch() {
  const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', () => undefined)
  child.stderr.on('data', () => undefined)
  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
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
      const gaveUp = setTimeout(() => {
        if (pending.delete(next)) {
          say('  eval timed out: the app stopped answering')
          resolve_(undefined)
        }
      }, 360_000)
      pending.set(next, (message) => {
        clearTimeout(gaveUp)
        const thrown = message.result?.exceptionDetails
        if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? ''}`.slice(0, 300))
        resolve_(message.result?.result?.value)
      })
      socket.send(JSON.stringify({ id: next, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  const stop = async () => {
    try { socket.close() } catch { /* closed */ }
    try { child.kill() } catch { /* gone */ }
    for (let i = 0; i < 40 && child.exitCode === null; i += 1) await sleep(250)
    await sleep(1000)
  }
  const discovered = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  return { evaluate, stop, discovered }
}

const teamRows = (evaluate) => evaluate(`(async () => {
  const team = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Team (Ctrl 2)')
  team.click()
  await new Promise(r => setTimeout(r, 800))
  return [...document.querySelectorAll('.lc-routinerow')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
})()`)

let app
try {
  say('1. the app starts and discovery finishes')
  app = await launch()
  check('discovery finished', app.discovered === true)

  say('2. a teammate, on Cursor / composer-2.5')
  const made = await app.evaluate(`(async () => {
    document.querySelector('button[aria-label="New teammate"]').click()
    await new Promise(r => setTimeout(r, 400))
    const input = document.querySelector('[role=dialog] input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Juno')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    const create = [...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Create teammate')
    if (!create || create.disabled) return 'create disabled'
    create.click()
    await new Promise(r => setTimeout(r, 600))
    const juno = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Juno'))
    if (!juno) return 'no teammate row'
    juno.click()
    await new Promise(r => setTimeout(r, 400))
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
  check('a teammate on Cursor / composer-2.5', /cursor/i.test(String(made)), String(made))

  say('3. one turn a person types')
  const sent = await app.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word ALPHA and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return true
    }
    return false
  })()`)
  check('the turn finished', sent === true)
  check('one mission recorded, started by a person', (await headers()).length === 1 && (await headers())[0].startedBy === undefined)

  say('4. save it as a routine that runs every few hours')
  const saved = await app.evaluate(`(async () => {
    const row = document.querySelector('.lc-teammate__mission')
    if (!row) return 'no conversation row'
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 260 }))
    await new Promise(r => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find(b => /Save as routine/.test(b.innerText))
    if (!item) return 'no menu item'
    if (item.disabled) return 'menu item disabled: ' + item.getAttribute('title')
    item.click()
    await new Promise(r => setTimeout(r, 500))
    const dialog = document.querySelector('[role=dialog][aria-label="Save as routine"]')
    if (!dialog) return 'dialog did not open'
    const every = [...dialog.querySelectorAll('[role=radio]')].find(b => /Every few hours/.test(b.innerText))
    if (!every) return 'no schedule choice'
    every.click()
    await new Promise(r => setTimeout(r, 300))
    const pick = dialog.querySelector('select[aria-label="Hours between runs"]')
    const note = [...dialog.querySelectorAll('p')].map(p => p.innerText).find(t => /Only while Locust is open/.test(t))
    const save = [...dialog.querySelectorAll('button')].find(b => b.innerText.trim() === 'Save routine')
    if (!save || save.disabled) return 'save disabled'
    save.click()
    await new Promise(r => setTimeout(r, 800))
    return JSON.stringify({ hours: pick ? pick.value : null, note: note ?? null, closed: !document.querySelector('[role=dialog][aria-label="Save as routine"]') })
  })()`)
  let dialog = {}
  try { dialog = JSON.parse(String(saved)) } catch { /* reported below */ }
  check('the hours control appeared, defaulting to 4, and the dialog said the limits out loud', dialog.hours === '4' && /Only while Locust is open/.test(String(dialog.note)) && dialog.closed === true, String(saved).slice(0, 220))

  say('5. the Team screen shows the schedule and the next run')
  const listed = await teamRows(app.evaluate)
  // Show the SCHEDULE part, not the first 200 characters of the card -- the
  // routine name ate the whole budget and the failure never showed what the
  // line actually said.
  const scheduleText = (String(listed).match(/every 4 hours[^|]{0,40}/) ?? ['no schedule line in the card'])[0]
  // routineScheduleSummary has FOUR shapes, all correct, and which one you
  // get depends on the clock: "next 06:12" today, "next tomorrow 02:08",
  // "next Sat 09:00" further out, and "due now" once it is due. Pinning only
  // the same-day one made this fail every evening -- it ran at 22:08, four
  // hours later is tomorrow, and the card rightly said so.
  check(
    'the card reads "every 4 hours · next <when>"',
    /every 4 hours · (due now|next (tomorrow |(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?\d\d:\d\d)/.test(String(listed)),
    scheduleText
  )

  const routinesPath = join(profile, 'routines.json')
  const file = JSON.parse(await readFile(routinesPath, 'utf8'))
  const routine = file.routines?.[0]
  check('the schedule is on disk', routine?.schedule?.kind === 'every' && routine?.schedule?.hours === 4, JSON.stringify(routine?.schedule))

  say('6. quit, back-date the routine five hours, relaunch, press nothing')
  await app.stop()
  app = undefined
  const backdated = new Date(Date.now() - 5 * 3_600_000).toISOString()
  file.routines[0] = { ...routine, createdAt: backdated }
  await writeFile(routinesPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  const before = (await ledgers()).length
  app = await launch()
  check('the app came back', app.discovered === true)

  const waitForLedgers = async (count, seconds) => {
    for (let i = 0; i < seconds * 2; i += 1) {
      if ((await ledgers()).length >= count) return true
      await sleep(500)
    }
    return false
  }
  // The first tick is 15 s after launch; discovery has already been waited for.
  check('a mission started on its own within the first tick', await waitForLedgers(before + 1, 60), `${String((await ledgers()).length)} ledgers`)
  const started = (await headers()).filter((h) => h.startedBy?.kind === 'routine')
  check('it is recorded as started by the routine, step 1', started.length === 1 && started[0].startedBy?.step === 1 && started[0].startedBy?.routineId === routine?.routineId, JSON.stringify(started.map((h) => h.startedBy)))
  check("it ran the person's words on the teammate's route", /ALPHA/.test(String(started[0]?.prompt)) && started[0]?.runtime === 'cursor', JSON.stringify([String(started[0]?.prompt).slice(0, 40), started[0]?.runtime]))

  say('7. the next tick does not start it again')
  // Let the step finish, then sit through more than one full tick.
  await app.evaluate(`(async () => {
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return true
    }
    return false
  })()`)
  await sleep(75_000)
  check('still exactly one scheduled start', (await headers()).filter((h) => h.startedBy?.kind === 'routine').length === 1, `${String((await ledgers()).length)} ledgers`)
  const after = JSON.parse(await readFile(routinesPath, 'utf8')).routines?.[0]
  check('the run was recorded: runs 1, lastRunAt set', after?.runs === 1 && typeof after?.lastRunAt === 'string', JSON.stringify({ runs: after?.runs, lastRunAt: after?.lastRunAt }))
  const rows = await teamRows(app.evaluate)
  check('the card says run 1 time and names the next run', /run 1 time/.test(String(rows)) && /every 4 hours · next /.test(String(rows)), String(rows).slice(0, 200))
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (app !== undefined) await app.stop()
  if (KEEP) say(`profile kept at ${profile}; workspace at ${workspace}`)
  else {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}

if (failures > 0) {
  say(`\n${String(failures)} SCHEDULE SMOKE FAILURE(S)`)
  process.exit(1)
}
say('\nSCHEDULE SMOKE PASSED')
