// Does a routine actually replay?
//
//   node _smoke/routine-smoke.mjs [--keep]
//
// The live proof for the feature: launch the BUILT app in a throwaway
// profile, make a teammate, run two turns on the cheap route (Cursor /
// composer-2.5), save that conversation as a routine from the row menu, then
// run it and watch two NEW missions appear -- the second only after the first
// completed -- with `startedBy: {kind:'routine'}` in both ledger headers and
// the second continuing the first.
//
// Asserted from the DURABLE RECORD, not the screen: a routine that looks like
// it ran and left no ledger did not run.

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
const PORT = 9298
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

const profile = await mkdtemp(join(tmpdir(), 'locust-routine-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-routine-ws-'))
await mkdir(profile, { recursive: true })
await writeFile(join(workspace, 'status.ts'), 'export const status = "draft";\n', 'utf8')
await writeFile(join(workspace, 'README.md'), '# scratch\n', 'utf8')

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

try {
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
      // A dead renderer never answers, and an await with no timeout then hangs
      // the whole run with no output at all. Say so and carry on failing.
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

  say('1. the app starts and discovery finishes')
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('discovery finished', ready === true)

  say('2. a teammate, on Cursor / composer-2.5')
  const made = await evaluate(`(async () => {
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

  const send = async (text) => evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
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

  say('3. two turns a person types')
  check('first turn finished', (await send('Reply with exactly the word ALPHA and nothing else.')) === true)
  check('second turn finished', (await send('Reply with exactly the word BETA and nothing else.')) === true)
  const taught = await headers()
  check('two missions recorded, neither started by anything but a person', taught.length === 2 && taught.every((h) => h.startedBy === undefined), `${String(taught.length)} ledgers`)

  say('4. save that conversation as a routine')
  const saved = await evaluate(`(async () => {
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
    const steps = [...dialog.querySelectorAll('textarea')].map(t => t.value)
    const save = [...dialog.querySelectorAll('button')].find(b => b.innerText.trim() === 'Save routine')
    if (!save || save.disabled) return 'save disabled'
    save.click()
    await new Promise(r => setTimeout(r, 800))
    return JSON.stringify({ steps })
  })()`)
  let steps = []
  try { steps = JSON.parse(String(saved)).steps ?? [] } catch { /* reported below */ }
  check('the dialog filled itself with both turns, in order', steps.length === 2 && /ALPHA/.test(steps[0] ?? '') && /BETA/.test(steps[1] ?? ''), String(saved).slice(0, 200))

  say('5. the routine is on the Team screen, under its teammate')
  const listed = await evaluate(`(async () => {
    const team = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Team (Ctrl 2)')
    team.click()
    await new Promise(r => setTimeout(r, 600))
    const rows = [...document.querySelectorAll('.lc-routinerow')].map(r => r.innerText.replace(/\\s+/g, ' '))
    return JSON.stringify(rows)
  })()`)
  check('one routine, named from its first step, not run yet', /2 steps/.test(String(listed)) && /not run yet/.test(String(listed)), String(listed).slice(0, 200))

  say('6. run it')
  const ran = await evaluate(`(async () => {
    const run = [...document.querySelectorAll('.lc-routinerow button')].find(b => b.innerText.trim() === 'Run')
    if (!run) return 'no Run button'
    if (run.disabled) return 'Run disabled'
    run.click()
    await new Promise(r => setTimeout(r, 1500))
    return 'clicked'
  })()`)
  check('Run started it', ran === 'clicked', String(ran))

  const waitForLedgers = async (count, seconds) => {
    for (let i = 0; i < seconds * 2; i += 1) {
      if ((await ledgers()).length >= count) return true
      await sleep(500)
    }
    return false
  }
  check('step 1 opened a new mission', await waitForLedgers(3, 240), `${String((await ledgers()).length)} ledgers`)
  check('step 2 opened only after step 1 completed', await waitForLedgers(4, 480), `${String((await ledgers()).length)} ledgers`)
  // Nothing else may start: 4 ledgers is 2 taught turns + 2 replayed steps.
  await sleep(8000)
  const all = await headers()
  check('the routine stopped at its last step', all.length === 4, `${String(all.length)} ledgers`)

  say('7. what the durable record says')
  const replayed = all.filter((h) => h.startedBy?.kind === 'routine')
  check('both replayed runs are recorded as the routine, step 1 then 2', replayed.length === 2 && replayed.some((h) => h.startedBy.step === 1) && replayed.some((h) => h.startedBy.step === 2), JSON.stringify(replayed.map((h) => h.startedBy)))
  check('both name the same routine', new Set(replayed.map((h) => h.startedBy?.routineId)).size === 1)
  // Against the route the routine actually STORED, not a constant. The
  // constant said `composer-2.5` and the run resolved to `composer-2.5-fast`,
  // which is correct -- Cursor lists both, the picker folds them into one row
  // with `fast` beside it, and the id that runs is the variant. A hardcoded
  // id turns that into a failure and, worse, would pass while a routine
  // quietly replayed on something other than what it was taught with.
  const stored = JSON.parse(await readFile(join(profile, 'routines.json'), 'utf8').catch(() => '{}'))
  const storedRoute = stored.routines?.[0]?.route
  check('the routine stored a route at all', storedRoute !== undefined, JSON.stringify(stored.routines?.length ?? 0))
  check(
    'both ran on the teammate route the routine was learned on',
    storedRoute !== undefined && replayed.every((h) => h.runtime === storedRoute.runtime && h.model === storedRoute.model),
    JSON.stringify({ storedRoute, ran: replayed.map((h) => [h.runtime, h.model]) })
  )
  // A route that carries an effort its runtime refuses is why step 1 never
  // opened a mission at all before 2026-09-07: Cursor's builder throws on any
  // effort, and the stored route had `{model: "composer-2.5-fast", effort:
  // "fast"}` -- the level already inside the id, and again beside it.
  check(
    'and it stored no effort the runtime would refuse',
    storedRoute !== undefined && (storedRoute.effort === undefined || !String(storedRoute.model).endsWith(`-${String(storedRoute.effort)}`)),
    JSON.stringify(storedRoute)
  )
  const second = replayed.find((h) => h.startedBy?.step === 2)
  const first = replayed.find((h) => h.startedBy?.step === 1)
  check('step 2 continues step 1, so the replay is one conversation', second?.continuesFrom?.missionId === first?.missionId, JSON.stringify({ follows: second?.continuesFrom?.missionId, first: first?.missionId }))
  check("the routine's own prompts are the person's words, not a briefing", /ALPHA/.test(String(first?.prompt)) && /BETA/.test(String(second?.prompt)), JSON.stringify([String(first?.prompt).slice(0, 40), String(second?.prompt).slice(0, 40)]))

  say('8. the Team screen counted the run')
  const after = await evaluate(`(async () => {
    const team = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Team (Ctrl 2)')
    team.click()
    /*
     * Poll for the COUNT rather than reading the row once after a fixed
     * pause. A routine's run counter moves when reconciliation confirms
     * the last step's mission against the ledger, which is a separate
     * beat from the step finishing -- so a single read 800ms after the
     * screen opens catches the card mid-reconcile and reports '0
     * completed runs, waiting for review' as though the routine had
     * stalled. Measured 2026-09-11 on an unchanged build: five runs went
     * FAIL, FAIL, PASS, PASS, PASS, then three more FAIL.
     */
    let rows = ''
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      rows = [...document.querySelectorAll('.lc-routinerow')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
      if (/run 1 time/.test(rows)) break
    }
    return rows
  })()`)
  check('the routine says it has run once', /run 1 time/.test(String(after)), String(after).slice(0, 200))
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
  say(`\n${String(failures)} ROUTINE SMOKE FAILURE(S)`)
  process.exit(1)
}
say('\nROUTINE SMOKE PASSED')
