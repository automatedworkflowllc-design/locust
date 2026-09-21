// Hub smoke: a teammate's replies to other teammates land in ONE conversation.
//
//   node _smoke/hub-smoke.mjs [--keep]
//
// Colin, 2026-09-21: "its kind of messy that each time a teammate messages
// another that it spawns a new chat in ungrouped." Two exchanges on the FREE
// OpenCode model, both started by a person messaging Wren, both asking Wren
// to message Booty. Before 0.234 that made TWO conversations of Booty's --
// one per exchange, each an Ungrouped row. Now Booty has a hub:
//
//   1. Booty's first relayed reply begins the hub, the host records it as
//      Booty's, and the row is named "Booty's replies".
//   2. Clicking Booty's face at the top of the sidebar opens that row.
//   3. Booty's reply in a SECOND exchange continues the hub -- one more turn
//      in the same row, not another row -- and the hub pointer moves to it.
//
// Whether a free model writes the share block it is asked for is the model's
// business; a run where no exchange happened is reported as such, not as a
// product failure. Costs up to six short free runs.

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const PORT = portFor(import.meta.url)
const FREE_MODEL = 'opencode/muse-spark-1.3-contributor-free'
const KEEP = process.argv.includes('--keep')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => console.error(line)
let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) say(`  [PASS] ${label}${detail ? ` -- ${detail}` : ''}`)
  else { failures += 1; say(`  [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const code = () => 'PEBBLE-' + String(Math.floor(Math.random() * 9000) + 1000)
const askToMessageBooty = (word) =>
  `Send your teammate Booty one message using the share block form, asking them to reply with exactly the word ${word} and nothing else. Do not read or edit any files, and do nothing else.`

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) { say(`  [FAIL] something is already debugging on port ${String(PORT)} -- close the other smoke first`); process.exit(1) }
} catch { /* free */ }

const workspace = await mkdtemp(join(tmpdir(), 'locust-hub-ws-'))
await writeFile(join(workspace, 'README.md'), '# scratch\n', 'utf8')
const profile = await mkdtemp(join(tmpdir(), 'locust-hub-'))
const LEDGER_DIR = join(profile, 'mission-ledger')
await mkdir(LEDGER_DIR, { recursive: true })
const T0 = '2026-09-21T05:00:00.000Z'
const route = { runtime: 'opencode', model: FREE_MODEL, mode: 'ask' }
const TEAMMATES = join(profile, 'teammates.json')
await writeFile(
  TEAMMATES,
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: T0, route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 4, memoryMode: 'auto' }
  })
)
const roster = async () => JSON.parse(await readFile(TEAMMATES, 'utf8'))
const ledgers = async () => (await readdir(LEDGER_DIR).catch(() => [])).filter((n) => n.endsWith('.jsonl'))
const headers = async () => {
  const names = await ledgers()
  const read = await Promise.all(names.map(async (name) => JSON.parse((await readFile(join(LEDGER_DIR, name), 'utf8')).split('\n')[0]).metadata))
  return read.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
/**
 * Wait until nothing is running and no new ledger has appeared for
 * `quietSeconds`, up to a ceiling.
 *
 * Both, not the count alone: the third run of this smoke counted one ledger
 * for 25 quiet seconds while Wren's run was still going on a slow free
 * model, and concluded no exchange had happened before it could.
 */
let settleProbe = async () => false
const settle = async (quietSeconds, ceilingSeconds) => {
  let names = await ledgers()
  let quiet = 0
  for (let i = 0; i < ceilingSeconds && quiet < quietSeconds; i += 1) {
    await sleep(1000)
    const now = await ledgers()
    const live = await settleProbe()
    if (now.length !== names.length || live) { names = now; quiet = 0 } else quiet += 1
  }
  return names.length
}

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
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
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up */ }
  }
  if (page === undefined) throw new Error('renderer never came up')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }) })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const send = (method, params = {}) => new Promise((resolve_) => {
    const next = ++id
    const gaveUp = setTimeout(() => { if (pending.delete(next)) { say('  eval timed out'); resolve_(undefined) } }, 600_000)
    pending.set(next, (message) => { clearTimeout(gaveUp); resolve_(message) })
    socket.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async (expression) => {
    const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    const thrown = message?.result?.exceptionDetails
    if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? ''}`.slice(0, 300))
    return message?.result?.result?.value
  }
  await send('Runtime.enable')
  // A running conversation pulses its dot in the sidebar, whichever one is
  // on screen; the Stop button covers the one that is.
  settleProbe = async () => (await evaluate(`!!(document.querySelector('.lc-sidebar .lc-conv .is-pulsing') || document.querySelector('button[aria-label^="Stop the running"]'))`)) === true

  say('1. the app starts on the seeded profile, replies on')
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('discovery finished', ready === true)

  /**
   * A NEW conversation with the named teammate, then send.
   *
   * Not the face: clicking a face shows that teammate's newest conversation
   * (their hub when they have one), so a message typed after it is a
   * follow-up -- measured on the first run of this smoke, where the second
   * "new" exchange chained onto the first. The hover card's "New
   * conversation with <name>" is the control that starts one.
   */
  const startWith = async (name, text) => evaluate(`(async () => {
    let face
    for (let i = 0; i < 40 && !face; i += 1) {
      face = [...document.querySelectorAll('.lc-faces__one')].find(b => (b.getAttribute('aria-label') || '').startsWith('${name} '))
      if (!face) await new Promise(r => setTimeout(r, 250))
    }
    if (!face) return 'no face for ${name}'
    // React's onMouseEnter listens to a BUBBLING mouseover.
    face.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    let fresh
    for (let i = 0; i < 40 && !fresh; i += 1) {
      await new Promise(r => setTimeout(r, 100))
      fresh = [...document.querySelectorAll('.lc-railflyout__action')].find(b => /New conversation with ${name}/.test(b.innerText))
    }
    if (!fresh) return 'no New conversation action for ${name}'
    fresh.click()
    await new Promise(r => setTimeout(r, 600))
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'no composer'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'sent :: ' + field.placeholder }
    }
    return 'send stayed disabled :: ' + field.placeholder
  })()`)

  const rows = async () => JSON.parse(await evaluate(`JSON.stringify([...document.querySelectorAll('.lc-sidebar .lc-conv')].map(r => ({
    title: (r.querySelector('.lc-conv__title') || { innerText: '' }).innerText.trim(),
    active: r.getAttribute('aria-current') === 'true'
  })))`))

  say('2. exchange one: a person asks Wren to message Booty')
  const first = code()
  const sentOne = await startWith('Wren', askToMessageBooty(first))
  check('the first mission was sent to Wren', String(sentOne).startsWith('sent') && /Wren/.test(String(sentOne)), String(sentOne))
  const afterOne = await settle(25, 420)
  const heads1 = await headers()
  const owners1 = (await roster()).missionOwners ?? {}
  const bootyRuns1 = heads1.filter((h) => owners1[h.missionId] === 'tm_booty')
  say(`       ledgers after exchange one: ${String(afterOne)} (Booty ran ${String(bootyRuns1.length)})`)
  if (bootyRuns1.length === 0) {
    say('       Wren did not message Booty (free-model behaviour); nothing below can be checked')
    check('an exchange happened', false, 'Booty never ran')
    throw new Error('no exchange')
  }
  const roster1 = await roster()
  const hub1 = roster1.teammates.find((t) => t.teammateId === 'tm_booty')?.hubMissionId
  check("the host recorded Booty's reply as Booty's hub", hub1 !== undefined && bootyRuns1.some((h) => h.missionId === hub1), JSON.stringify({ hub1, booty: bootyRuns1.map((h) => h.missionId) }))
  check("Booty's first reply began a root, not a follow-up of something else", bootyRuns1[0]?.continuesFrom === undefined, JSON.stringify(bootyRuns1[0]?.continuesFrom))
  check('the hub row is named for Booty', roster1.missionTitles?.[bootyRuns1[0]?.missionId] === "Booty's replies", JSON.stringify(roster1.missionTitles))
  check('Wren has no hub: their turns were all inside the exchange', roster1.teammates.find((t) => t.teammateId === 'tm_wren')?.hubMissionId === undefined)
  const rows1 = await rows()
  say(`       rows: ${JSON.stringify(rows1)}`)
  check('the sidebar lists two conversations: the person\u2019s with Wren, and Booty\u2019s replies', rows1.length === 2 && rows1.some((r) => r.title === "Booty's replies"), JSON.stringify(rows1))

  say("3. Booty's face opens the hub")
  const opened = JSON.parse(await evaluate(`(async () => {
    const face = [...document.querySelectorAll('.lc-faces__one')].find(b => (b.getAttribute('aria-label') || '').startsWith('Booty '))
    if (!face) return JSON.stringify({ face: false })
    face.click()
    await new Promise(r => setTimeout(r, 800))
    return JSON.stringify({
      face: true,
      label: face.getAttribute('aria-label'),
      on: face.classList.contains('is-on'),
      active: [...document.querySelectorAll('.lc-sidebar .lc-conv[aria-current="true"] .lc-conv__title')].map(t => t.innerText.trim()),
      header: (document.querySelector('.lc-workroom__name') || { innerText: '' }).innerText.trim(),
      placeholder: (document.querySelector('form.command-dock textarea') || { placeholder: '' }).placeholder,
      filtered: !!document.querySelector('.lc-faces__clear')
    })
  })()`))
  say(`       ${JSON.stringify(opened)}`)
  check('the face says what it does', opened.label === 'Booty — open their conversation', opened.label)
  check("the hub row is the active conversation", opened.active?.length === 1 && opened.active[0] === "Booty's replies", JSON.stringify(opened.active))
  check('the composer addresses Booty, and the face is on', /Booty/.test(opened.placeholder) && opened.on === true, opened.placeholder)
  check('the list was NOT filtered by the click', opened.filtered === false)

  say('4. exchange two: a new conversation with Wren, the same ask')
  // Whether a free model writes the share block is its business, so the ask
  // is repeated -- each a fresh conversation -- until Booty runs again or
  // three tries have been spent. Reported either way.
  let bootyRuns2 = bootyRuns1
  let heads2 = heads1
  for (let attempt = 1; attempt <= 3 && bootyRuns2.length <= bootyRuns1.length; attempt += 1) {
    const sentTwo = await startWith('Wren', askToMessageBooty(code()))
    check(`the second mission was sent to Wren (try ${String(attempt)})`, String(sentTwo).startsWith('sent'), String(sentTwo))
    const afterTwo = await settle(25, 420)
    heads2 = await headers()
    const owners2 = (await roster()).missionOwners ?? {}
    bootyRuns2 = heads2.filter((h) => owners2[h.missionId] === 'tm_booty')
    say(`       ledgers after try ${String(attempt)}: ${String(afterTwo)} (Booty ran ${String(bootyRuns2.length)})`)
  }
  if (bootyRuns2.length <= bootyRuns1.length) {
    say('       Wren did not message Booty this time (free-model behaviour); the second half cannot be checked')
    check('a second exchange happened', false, 'Booty did not run again')
  } else {
    const newest = bootyRuns2[bootyRuns2.length - 1]
    const roster2 = await roster()
    const hub2 = roster2.teammates.find((t) => t.teammateId === 'tm_booty')?.hubMissionId
    check("Booty's newest reply continues the hub as a follow-up", newest?.continuesFrom?.reason === 'follow-up' && bootyRuns1.some((h) => h.missionId === newest?.continuesFrom?.missionId), JSON.stringify(newest?.continuesFrom))
    check('the hub pointer moved to the newest turn', hub2 === newest?.missionId, JSON.stringify({ hub2, newest: newest?.missionId }))
    const rows2 = await rows()
    say(`       rows: ${JSON.stringify(rows2)}`)
    const persons = heads2.filter((h) => h.startedBy === undefined).length
    check(`${String(persons + 1)} conversations, not ${String(persons + 2)}: the person\u2019s ${String(persons)} with Wren, and ONE of Booty\u2019s replies`, rows2.length === persons + 1 && rows2.filter((r) => r.title === "Booty's replies").length === 1, JSON.stringify(rows2))
  }
} catch (error) {
  if (!(error instanceof Error && error.message === 'no exchange')) {
    failures += 1
    say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
    say(appOutput.join('').slice(-1500))
  }
} finally {
  child.kill()
  await sleep(500)
  if (KEEP) say(`profile kept at ${profile}`)
  else await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

console.error(failures === 0 ? '\nHUB SMOKE PASSED' : `\n${String(failures)} HUB SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
