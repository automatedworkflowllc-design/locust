// A conversation with nobody, and handing it to someone afterwards.
//
//   node _smoke/raw-conversation-smoke.mjs
//
// Colin, 2026-09-05: "with a conversation that has no agent created you can
// assign one after the fact". No Conversation tab -- a mission already is a
// conversation and a teammate is a saved route with a face. So from the home
// screen, with nobody picked, the composer addresses nobody; picking a
// teammate addresses them; and a mission's own right-click menu offers
// "Assign to <name>", which the host records and the sidebar mirrors.
//
// Seeded from the ledger, so no runtime is spent: one teammate, one mission
// of nobody's.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9233

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)}`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const workspace = await mkdtemp(join(tmpdir(), 'locust-raw-ws-'))
await writeFile(join(workspace, 'README.md'), '# raw\n', 'utf8')
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const profile = await mkdtemp(join(tmpdir(), 'locust-raw-'))
const LEDGER_DIR = join(profile, 'mission-ledger')
await mkdir(LEDGER_DIR, { recursive: true })
const TEAMMATES = join(profile, 'teammates.json')
await writeFile(
  TEAMMATES,
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T00:00:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false }
  })
)
const T0 = '2026-09-05T02:00:00.000Z'
const metadata = {
  missionId: 'mission_nobody',
  runId: 'run_mission_nobody',
  prompt: 'Which files mention the release date?',
  runtime: 'codex',
  model: 'account-default',
  requestedRouteId: 'codex',
  resolvedRouteId: 'codex-account:default',
  cliVersion: '0.153.0',
  workspaceId: WORKSPACE_ID,
  sandbox: 'read-only',
  executionPolicyVersion: 1,
  createdAt: T0
}
await writeFile(
  join(LEDGER_DIR, 'mission_nobody.jsonl'),
  `${JSON.stringify({ schemaVersion: 7, recordType: 'mission.created', ledgerSequence: 1, occurredAt: T0, metadata })}\n`,
  'utf8'
)

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
  }
  if (page === undefined) throw new Error('renderer never came up')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res) => socket.addEventListener('open', res, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const w = pending.get(m.id)
    if (w) { pending.delete(m.id); w(m) }
  })
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((res) => {
        const n = ++id
        pending.set(n, res)
        socket.send(JSON.stringify({ id: n, method, params }))
      }),
      new Promise((resolve) => { const t = setTimeout(() => resolve({ error: { message: 'cdp timeout' } }), 420_000); t.unref() })
    ])
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (m.error) throw new Error(JSON.stringify(m.error))
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return m.result?.result?.value
  }
  await evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      const f = document.querySelector('form.command-dock textarea')
      if (f && !/Checking local runtimes/.test(f.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  say('1. the home screen addresses nobody')
  const home = JSON.parse(await evaluate(`JSON.stringify({
    placeholder: document.querySelector('form.command-dock textarea').placeholder,
    sidebar: document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' '),
    highlighted: document.querySelectorAll('.lc-teammate.is-selected').length,
    home: !!document.querySelector('.lc-runtimepanel')
  })`))
  say(`       ${JSON.stringify(home)}`)
  // Colin, 2026-09-05: launch opened on the newest finished conversation
  // instead of the home screen. The seeded mission is finished, so the
  // runtime panel must be what the window opens on.
  check('the window opens on the home screen, not the newest finished conversation', home.home === true, String(home.home))
  check('the box invites a plain message, not a message to the first teammate', home.placeholder === 'Write a message…', home.placeholder)
  // User session, 2026-09-05: with nobody picked the first teammate was drawn
  // as chosen while the composer addressed nobody.
  check('no teammate is drawn as chosen when nobody is', home.highlighted === 0, String(home.highlighted))
  // The section is titled just "Missions" since 2026-09-06 (Colin: "just have
  // it say missions lol, why other missions?"), so this asserts the section
  // EXISTS and holds the conversation rather than pinning its old wording.
  check('the mission of nobody\'s is listed outside the roster', /MISSIONS[\s\S]*release date/i.test(home.sidebar), home.sidebar.slice(0, 200))

  say('2. picking a teammate addresses them')
  const picked = await evaluate(`(async () => {
    document.querySelector('.lc-teammate .lc-row').click()
    await new Promise(r => setTimeout(r, 400))
    return JSON.stringify({
      placeholder: document.querySelector('form.command-dock textarea').placeholder,
      highlighted: document.querySelectorAll('.lc-teammate.is-selected').length
    })
  })()`)
  const pickedState = JSON.parse(picked)
  check('the box now says who it goes to', pickedState.placeholder === 'Message Wren…', pickedState.placeholder)
  check('and the pick is drawn as chosen', pickedState.highlighted === 1, String(pickedState.highlighted))

  say('3. the mission\'s own menu can hand it to a teammate')
  const menu = JSON.parse(await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-sidebar .lc-row')].find(r => /release date/i.test(r.innerText))
    if (!row) return JSON.stringify({ found: false })
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
    await new Promise(r => setTimeout(r, 300))
    const items = [...document.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim())
    return JSON.stringify({ found: true, items })
  })()`))
  say(`       menu: ${JSON.stringify(menu.items ?? menu)}`)
  check('the mission row was found', menu.found === true)
  check('it offers Assign to Wren', (menu.items ?? []).includes('Assign to Wren'), JSON.stringify(menu.items))

  const after = JSON.parse(await evaluate(`(async () => {
    const item = [...document.querySelectorAll('.lc-context__item')].find(b => b.innerText.trim() === 'Assign to Wren')
    item.click()
    await new Promise(r => setTimeout(r, 900))
    const sidebar = document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ')
    return JSON.stringify({ sidebar, menuOpen: document.querySelector('.lc-context') !== null })
  })()`))
  say(`       ${after.sidebar.slice(0, 220)}`)
  check('the menu closed', after.menuOpen === false)
  check('the mission now sits under Wren, not under Other missions', /Wren.*release date/i.test(after.sidebar) && !/MISSIONS[^\n]*\n[^\n]*release date/i.test(after.sidebar), after.sidebar.slice(0, 220))

  await sleep(600)
  const stored = JSON.parse(await readFile(TEAMMATES, 'utf8'))
  say(`       missionOwners on disk: ${JSON.stringify(stored.missionOwners)}`)
  check('the host recorded the owner', stored.missionOwners?.mission_nobody === 'tm_wren', JSON.stringify(stored.missionOwners))

  say('4. the menu no longer offers the owner it already has')
  const again = JSON.parse(await evaluate(`(async () => {
    // Under a teammate the mission is a different element than a row of
    // nobody's; the deepest element carrying the words is what a pointer
    // would hit, and the menu handler is on an ancestor either way.
    const row = [...document.querySelectorAll('.lc-sidebar *')].filter(el => /release date/i.test(el.innerText ?? '')).at(-1)
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
    await new Promise(r => setTimeout(r, 300))
    return JSON.stringify([...document.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim()))
  })()`))
  check('no Assign to Wren on a mission that is already Wren\'s', !again.includes('Assign to Wren'), JSON.stringify(again))
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1200)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-1500))
  say(`\n${String(failures)} RAW-CONVERSATION FAILURE(S)`)
  process.exit(1)
}
say('\nraw-conversation smoke passed')
