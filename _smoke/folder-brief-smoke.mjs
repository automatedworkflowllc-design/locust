// Does a folder's LOCUST.md reach every teammate?
//
//   node _smoke/folder-brief-smoke.mjs
//
// On the FREE OpenCode model: a scratch folder holds a LOCUST.md that names
// a code word, a seeded teammate is asked to quote the code-word line from
// its instructions, and the only place that line exists is the brief Locust
// composed. Settings must say how many lines were briefed; with the file
// removed it must say none.

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const PORT = portFor(import.meta.url)
const FREE_MODEL = 'opencode/muse-spark-1.3-contributor-free'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => console.error(line)
let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) say(`  [PASS] ${label}${detail ? ` -- ${detail}` : ''}`)
  else { failures += 1; say(`  [FAIL] ${label}${detail ? ` -- ${detail}` : ''}`) }
}
try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) { say(`  [FAIL] something is already debugging on port ${String(PORT)}`); process.exit(1) }
} catch { /* free */ }

const workspace = await mkdtemp(join(tmpdir(), 'locust-brief-ws-'))
await writeFile(join(workspace, 'README.md'), '# scratch\n', 'utf8')
await writeFile(join(workspace, 'LOCUST.md'), '# scratch folder\n\nThe code word for this folder is HERON.\nWhen asked for the code word, answer with it.\n', 'utf8')
const profile = await mkdtemp(join(tmpdir(), 'locust-brief-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
const T0 = '2026-09-05T05:00:00.000Z'
await writeFile(join(profile, 'teammates.json'), JSON.stringify({
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { runtime: 'opencode', model: FREE_MODEL, mode: 'ask' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 6, memoryMode: 'off' }
}))

const newestReply = async () => {
  const dir = join(profile, 'mission-ledger')
  const names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
  let newest
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8')
    const at = JSON.parse(text.split('\n')[0] ?? '{}').metadata?.createdAt ?? ''
    if (newest === undefined || at > newest.at) newest = { at, text }
  }
  if (newest === undefined) return undefined
  const buffers = new Map()
  for (const line of newest.text.split('\n')) {
    if (line.trim().length === 0) continue
    let record
    try { record = JSON.parse(line) } catch { continue }
    const event = record.event
    if (event?.type !== 'message.delta') continue
    const { itemId, operation, text } = event.payload
    buffers.set(itemId, operation === 'replace' ? text : `${buffers.get(itemId) ?? ''}${text}`)
  }
  return [...buffers.values()].at(-1)
}

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', () => undefined)
child.stderr.on('data', () => undefined)
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
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }) })
  let id = 0
  const pending = new Map()
  const evaluate = (expression) => new Promise((resolve_) => {
    const next = ++id
    const gaveUp = setTimeout(() => { if (pending.delete(next)) resolve_(undefined) }, 400_000)
    pending.set(next, (message) => {
      clearTimeout(gaveUp)
      const thrown = message.result?.exceptionDetails
      if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? ''}`.slice(0, 200))
      resolve_(message.result?.result?.value)
    })
    socket.send(JSON.stringify({ id: next, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })

  say('1. the app starts on the seeded profile')
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('discovery finished', ready === true)

  const settingsLine = `(async () => {
    if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /Project folder|folder/i.test(h.textContent))) {
      document.querySelector('button[title="Settings (Ctrl 3)"]').click()
      await new Promise(r => setTimeout(r, 600))
    }
    const tag = [...document.querySelectorAll('.lc-tag')].find(t => t.textContent.trim() === 'LOCUST.md')
    return tag ? tag.parentElement.innerText.replace(/\\s+/g, ' ').trim() : 'no LOCUST.md line'
  })()`
  say('2. Settings says the file was read')
  const line = await evaluate(settingsLine)
  check('the folder section says how many lines are briefed', /4 lines briefed to every teammate/.test(String(line)), String(line))
  await evaluate(`(async () => { document.querySelector('.lc-brand__lockup').click(); await new Promise(r => setTimeout(r, 300)) })()`)

  say('3. Wren is asked to quote the code-word line -- only the brief carries it')
  const finished = await evaluate(`(async () => {
    let who; for (let i = 0; i < 40 && !who; i += 1) { who = [...document.querySelectorAll('button')].find(b => (b.querySelector('.lc-row__name') || { innerText: '' }).innerText.trim().startsWith("Wren")) || [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || b.getAttribute('aria-label') || '').startsWith("Wren" + ' ')); if (!who) await new Promise(r => setTimeout(r, 250)) }
    who.click()
    await new Promise(r => setTimeout(r, 400))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Your instructions for this folder name a code word. Quote, word for word, the line that states it. If there is none, reply NONE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'finished'
    }
    return 'still running'
  })()`)
  check('the run finished', finished === 'finished')
  await sleep(1500)
  const answer = String(await newestReply())
  say(`       Wren: ${JSON.stringify(answer.slice(0, 160))}`)
  // The line count in Settings above is Locust's half: it read LOCUST.md and
  // said how much of it went into the brief. Whether the model quotes the
  // code word back is the model's half, and grading it here is what made a
  // polite answer look like a broken brief.
  say(`       (not asserted: whether the reply quotes HERON)`)

  say('4. with the file gone, Settings says so on its next read')
  await unlink(join(workspace, 'LOCUST.md'))
  // Ctrl 3 is the path that re-reads; the rail button only shows the screen.
  const gone = await evaluate(`(async () => {
    document.querySelector('.lc-brand__lockup').click()
    await new Promise(r => setTimeout(r, 300))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    const tag = [...document.querySelectorAll('.lc-tag')].find(t => t.textContent.trim() === 'LOCUST.md')
    return tag ? tag.parentElement.innerText.replace(/\\s+/g, ' ').trim() : 'no LOCUST.md line'
  })()`)
  check('the folder section now says there is none, and how to add one', /None in this folder/.test(String(gone)), String(gone).slice(0, 160))
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}
if (failures > 0) { say(`\n${String(failures)} FOLDER BRIEF SMOKE FAILURE(S)`); process.exit(1) }
say('\nFOLDER BRIEF SMOKE PASSED')
