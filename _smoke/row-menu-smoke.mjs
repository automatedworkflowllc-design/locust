// Row-menu smoke: right-clicking a mission offers its actions, and Delete
// still asks before it acts.
//
//   node _smoke/row-menu-smoke.mjs
//
// Starts NO mission and spends no provider quota. It seeds a ledger, opens
// the menu on a row, checks the first press only ARMS the delete, and that
// the second press removes the mission from the sidebar and from disk.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = portFor(import.meta.url)
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
        // this replaced kept the process alive for up to 240s after the
        // last line (six smokes 'not exiting cleanly', QA on 0.21.2).
        let ticks = 0
        const tick = setInterval(() => {
          ticks += 1
          if (child.exitCode !== null) { clearInterval(tick); resolve({ error: { message: `app exited ${child.exitCode}` } }) }
          else if (ticks >= 240) { clearInterval(tick); resolve({ error: { message: 'cdp timeout' } }) }
        }, 1000)
        tick.unref()
        settleTimers.add(tick)
        })
    ])
  }
  async eval(expression) {
    const message = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (message.error) throw new Error(JSON.stringify(message.error))
    if (message.result?.exceptionDetails) {
      throw new Error(message.result.exceptionDetails.exception?.description ?? 'evaluate threw')
    }
    return message.result?.result?.value
  }
}

// The sidebar shows THIS folder's missions, and a mission records its folder
// as a hash of the path. A seeded literal (`ws_smoke`) therefore stopped
// matching the moment workspace scoping landed on 2026-09-03: the rows were
// filtered out, no row meant no right-click, and this smoke reported the
// context menu as broken. It was not -- it had simply been seeding missions
// into a folder the app was not looking at, and nobody knew for two days,
// because the smokes are run by hand.
//
// Derived the way the app derives it, from the same cwd the app is launched
// with, so this cannot drift again without the app's own function changing.
// `resolve` because the app hashes `process.cwd()`, which on Windows is
// backslashed with no trailing separator -- APP_DIR is a URL pathname and is
// neither, and hashing it would produce a different id that matches nothing.
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(APP_DIR), 'utf8').digest('hex').slice(0, 32)}`

const profile = await mkdtemp(join(tmpdir(), 'locust-rowmenu-'))
const LEDGER_DIR = join(profile, 'mission-ledger')
await mkdir(LEDGER_DIR, { recursive: true })
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T00:00:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false }
  })
)
const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
for (const [missionId, prompt] of [
  ['mission_keepme', 'Audit the config'],
  ['mission_deleteme', 'Rewrite the README']
]) {
  const metadata = {
    missionId,
    runId: `run_${missionId}`,
    prompt,
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.151.0',
    workspaceId: WORKSPACE_ID,
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt
  }
  await writeFile(
    join(LEDGER_DIR, `${missionId}.jsonl`),
    `${JSON.stringify({ schemaVersion: 7, recordType: 'mission.created', ledgerSequence: 1, occurredAt: createdAt, metadata })}\n`,
    'utf8'
  )
}

const ledgerNames = async () =>
  (await readdir(LEDGER_DIR)).filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -6)).sort()

const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts on two seeded missions')
  check('two missions on disk', (await ledgerNames()).length === 2)
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
  check('renderer target available', page !== undefined)
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

  say('2. right-clicking a mission row opens its menu')
  const opened = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      // `.lc-conv` is the conversation row in the wide sidebar since 0.207;
      // `.lc-row` is the compact rail's shape and the roster's.
      const rows = [...document.querySelectorAll('.lc-conv, .lc-row')].filter(r => /Rewrite the README/.test(r.innerText))
      if (rows.length === 0) continue
      const row = rows[0]
      const box = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10)
      }))
      await new Promise(r => setTimeout(r, 300))
      const menu = document.querySelector('.lc-context')
      if (!menu) continue
      return JSON.stringify({
        title: menu.querySelector('.lc-context__title').innerText.trim(),
        items: [...menu.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim())
      })
    }
    return JSON.stringify({ items: [] })
  })()`)
  const menu = JSON.parse(opened)
  say(`       menu: ${menu.title} · ${JSON.stringify(menu.items)}`)
  check('the menu names the row it was opened on', /rewrite the readme/i.test(menu.title ?? ''), menu.title)
  // Named items, not an exact list: this asserted the whole array once, and
  // adding "Save as routine" turned a working menu into a red smoke.
  for (const item of ['Open', 'Copy mission id', 'Delete']) {
    check(`it offers ${item}`, menu.items.includes(item), JSON.stringify(menu.items))
  }

  say('3. the first press on Delete only asks')
  const armed = await cdp.eval(`(async () => {
    const del = [...document.querySelectorAll('.lc-context__item')].find(b => /^Delete/.test(b.innerText.trim()))
    del.click()
    await new Promise(r => setTimeout(r, 300))
    const menu = document.querySelector('.lc-context')
    return JSON.stringify({
      open: menu !== null,
      label: menu ? [...menu.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim()).at(-1) : ''
    })
  })()`)
  const armedState = JSON.parse(armed)
  check('the menu stays open', armedState.open === true, armed)
  check('and asks for good', armedState.label === 'Delete for good?', armedState.label)
  check('nothing was deleted yet', (await ledgerNames()).length === 2, (await ledgerNames()).join(','))

  say('4. the second press deletes it')
  await cdp.eval(`(async () => {
    const del = [...document.querySelectorAll('.lc-context__item')].find(b => /Delete for good/.test(b.innerText))
    del.click()
    await new Promise(r => setTimeout(r, 1500))
    return true
  })()`)
  const left = await ledgerNames()
  check('only the chosen mission is gone', left.join(',') === 'mission_keepme', left.join(','))
  const sidebar = await cdp.eval(`document.querySelector('.lc-sidebar').innerText`)
  check('and it is gone from the sidebar', !/Rewrite the README/.test(sidebar), sidebar.replace(/\s+/g, ' ').slice(0, 160))
  check('the other mission is still listed', /Audit the config/.test(sidebar))
  check('the menu closed', (await cdp.eval(`document.querySelector('.lc-context') === null`)) === true)

  // Colin, 2026-09-05: "got to add an option for a right click delete teammate
  // too id imagine". A teammate row had no context menu at all, so the gesture
  // that works on a mission silently did nothing one row above it.
  say('5. right-clicking a TEAMMATE offers the same menu')
  const onTeammate = JSON.parse(await cdp.eval(`(async () => {
    // The roster is the face rail in the wide sidebar; a face carries the
    // same context menu the old teammate row did.
    const row = document.querySelector('.lc-faces__one') || document.querySelector('.lc-teammate .lc-row')
    if (!row) return JSON.stringify({ found: false })
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10)
    }))
    await new Promise(r => setTimeout(r, 300))
    const menu = document.querySelector('.lc-context')
    return JSON.stringify({
      found: true,
      open: menu !== null,
      title: menu ? menu.querySelector('.lc-context__title').innerText.trim() : '',
      items: menu ? [...menu.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim()) : []
    })
  })()`))
  say(`       menu: ${onTeammate.title} · ${JSON.stringify(onTeammate.items)}`)
  check('the teammate row is on screen to right-click', onTeammate.found === true)
  check('a menu opens on it', onTeammate.open === true)
  check('and it names the teammate', /wren/i.test(onTeammate.title ?? ''), onTeammate.title)
  check('it offers Remove teammate', (onTeammate.items ?? []).includes('Remove teammate'), JSON.stringify(onTeammate.items))

  say('6. removing a teammate also asks first')
  const teammateArmed = JSON.parse(await cdp.eval(`(async () => {
    const remove = [...document.querySelectorAll('.lc-context__item')].find(b => /^Remove teammate/.test(b.innerText.trim()))
    remove.click()
    await new Promise(r => setTimeout(r, 300))
    const menu = document.querySelector('.lc-context')
    return JSON.stringify({
      open: menu !== null,
      label: menu ? [...menu.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim()).at(-1) : '',
      roster: document.querySelector('.lc-sidebar').innerText
    })
  })()`))
  check('the menu stays open', teammateArmed.open === true)
  check('and asks before removing', /^Remove/.test(teammateArmed.label ?? '') && /\?$/.test(teammateArmed.label ?? ''), teammateArmed.label)
  check('nobody was removed yet', /Wren/.test(teammateArmed.roster ?? ''))

  say('7. the second press removes them')
  const gone = await cdp.eval(`(async () => {
    const remove = [...document.querySelectorAll('.lc-context__item')].find(b => /^Remove.*\\?$/.test(b.innerText.trim()))
    remove.click()
    await new Promise(r => setTimeout(r, 1200))
    return document.querySelector('.lc-sidebar').innerText
  })()`)
  check('the teammate is gone from the roster', !/Wren/.test(gone), gone.replace(/\s+/g, ' ').slice(0, 160))
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-1500))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\nrow-menu smoke passed')
