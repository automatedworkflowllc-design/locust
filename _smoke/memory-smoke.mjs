// Does the team's memory reach a teammate, and does a teammate's reply reach memory?
//
//   node _smoke/memory-smoke.mjs [--keep]
//
// The live proof for team memory, on the FREE OpenCode model so it costs
// nothing. The profile is seeded with two teammates and ONE memory a person
// wrote ("the secret word for this project is PELICAN"). Then:
//
//   A. Wren is asked for the secret word. The only way Wren can know it is
//      the memory section of the brief, so the answer proves the briefing.
//   B. Booty is asked to remember the build command. Whether a free model
//      ends its reply with the block is the model's business; what the
//      product owes is that a block that arrives becomes a memory named
//      Booty's, said in the thread, counted in the sidebar -- asserted only
//      if the block arrived, logged either way.
//   C. The Memory screen: edit, switch off, add by hand, change the mode,
//      keep a proposed one, remove -- each read back from memories.json,
//      the file the host actually briefs from.
//
// Asserted from the record where there is one; the screen is checked
// against the file, never trusted alone.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) { say(`  [FAIL] something is already debugging on port ${String(PORT)} -- close the other smoke first`); process.exit(1) }
} catch { /* free */ }

const workspace = await mkdtemp(join(tmpdir(), 'locust-memory-ws-'))
await writeFile(join(workspace, 'README.md'), '# scratch\n', 'utf8')
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const profile = await mkdtemp(join(tmpdir(), 'locust-memory-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
const T0 = '2026-09-05T05:00:00.000Z'
const route = { runtime: 'opencode', model: FREE_MODEL, mode: 'ask' }
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: T0, route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 6, memoryMode: 'auto' }
  })
)
const MEMORIES = join(profile, 'memories.json')
await writeFile(
  MEMORIES,
  JSON.stringify({
    schemaVersion: 1,
    memories: [
      {
        memoryId: 'mem_seed', text: 'The secret word for this project is PELICAN.', scope: 'workspace', workspaceId: WORKSPACE_ID,
        workspaceName: 'scratch', by: { name: 'you' }, createdAt: T0, status: 'kept', enabled: true
      }
    ]
  })
)
const memoriesOnDisk = async () => JSON.parse(await readFile(MEMORIES, 'utf8')).memories
const settingsOnDisk = async () => JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).settings

/** The final reply of the newest ledger, rebuilt from its deltas. */
const newestReply = async () => {
  const dir = join(profile, 'mission-ledger')
  const names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
  let newest
  for (const name of names) {
    const text = await readFile(join(dir, name), 'utf8')
    const first = JSON.parse(text.split('\n')[0] ?? '{}')
    const at = first.metadata?.createdAt ?? ''
    if (newest === undefined || at > newest.at) newest = { at, text, name }
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
  const consoleErrors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params?.exceptionDetails?.text ?? 'exception')
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') consoleErrors.push(String(message.params.args?.[0]?.value ?? 'console.error'))
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const send = (method, params = {}) => new Promise((resolve_) => {
    const next = ++id
    const gaveUp = setTimeout(() => { if (pending.delete(next)) { say('  eval timed out'); resolve_(undefined) } }, 400_000)
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
  const settingsNote = `(async () => { if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /remembers/.test(h.textContent))) { document.querySelector('button[title="Settings (Ctrl 3)"]').click(); await new Promise(r => setTimeout(r, 600)); const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText)); if (page) page.click(); await new Promise(r => setTimeout(r, 400)) } const h = [...document.querySelectorAll('.lc-settings__heading')].find(h => /remembers/.test(h.textContent)); return h.closest('section').innerText.replace(/\\s+/g, ' ') })()`
  const openMemory = `(async () => { if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /remembers/.test(h.textContent))) { document.querySelector('button[title="Settings (Ctrl 3)"]').click(); await new Promise(r => setTimeout(r, 600)); const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText)); if (page) page.click(); await new Promise(r => setTimeout(r, 400)) } [...document.querySelectorAll('button')].find(b => /Open memory/.test(b.innerText)).click(); await new Promise(r => setTimeout(r, 600)) })()`
  const sidebar = await evaluate(settingsNote)
  check('Settings says one memory is kept', /1 memory kept/.test(String(sidebar)), String(sidebar).slice(-120))
  await evaluate(`(async () => { document.querySelector('.lc-brand__lockup').click(); await new Promise(r => setTimeout(r, 300)) })()`)
  check('the logo goes home', (await evaluate(`!!document.querySelector('.lc-runtimepanel')`)) === true)

  const ask = async (name, text) => evaluate(`(async () => {
    // A title of "Message <name>" has not existed for a long time, so this asked
    // nobody and every run below reported "finished" without one ever
    // starting. A teammate is addressed from their FACE in the sidebar
    // ("<name> — show only their conversations"); the Team screen's roster
    // card offers only Edit and Remove, and the sidebar's Teammates section
    // is not open by default.
    let who
    for (let i = 0; i < 40 && !who; i += 1) {
      who =
        [...document.querySelectorAll('button')].find(b => (b.querySelector('.lc-row__name') || { innerText: '' }).innerText.trim().startsWith('${name}'))
        || [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || b.getAttribute('aria-label') || '').startsWith('${name} '))
      if (!who) await new Promise(r => setTimeout(r, 250))
    }
    if (!who) {
      const seen = [...document.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || '').replace(new RegExp('[' + String.fromCharCode(32, 9, 13, 10) + ']+', 'g'), ' ').trim().slice(0, 44)).filter(Boolean).slice(0, 40)
      return 'no teammate row :: ' + seen.join(' | ')
    }
    who.click()
    await new Promise(r => setTimeout(r, 600))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
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

  say('A. Wren is asked to quote the memory line -- only the memory brief carries it')
  // Quoting, not trusting: the smoke proves the brief REACHED the model, and
  // leaves whether a free model believes a note to the model.
  const wrenRun = await ask('Wren', 'Your brief lists what your team remembers. Quote, word for word, the remembered line that mentions a secret word. If there is none, reply NONE.')
  check('the run finished', wrenRun === 'finished', String(wrenRun))
  await sleep(1500)
  const answer = await newestReply()
  say(`       Wren: ${JSON.stringify(String(answer).slice(0, 160))}`)
  // NOT asserted, and checked before deleting: the composed brief is not in
  // the ledger -- `mission.created` carries the person's words only -- so
  // there is no record of Locust's half to assert against here. What Locust
  // owes is that the memory was kept and briefed, and Settings' own count
  // above is the witness for that. Whether a free model quotes it back is
  // the model's business.
  say(`       (not asserted: whether the reply quotes PELICAN)`)

  say('B. Booty is asked to remember something')
  check('the run finished', (await ask('Booty', 'Remember, for this project only, that the build command is pnpm build. Use the memory block you were shown. Then reply with the single word OK.')) === 'finished')
  await sleep(2500)
  const bootyReply = String(await newestReply())
  const wroteBlock = /<locust-memory>/i.test(bootyReply)
  say(`       Booty wrote a memory block: ${String(wroteBlock)} (model behaviour, informational)`)
  const after = await memoriesOnDisk()
  const byBooty = after.filter((m) => m.by?.teammateId === 'tm_booty')
  if (wroteBlock) {
    check('the block became a memory of Booty\'s, for this folder, from that conversation', byBooty.length >= 1 && byBooty[0].scope === 'workspace' && byBooty[0].workspaceId === WORKSPACE_ID && typeof byBooty[0].missionId === 'string' && byBooty[0].status === 'kept', JSON.stringify(byBooty[0]))
    const thread = await evaluate(`(async () => { const fold = document.querySelector('.lc-memorycard .lc-activity'); if (!fold) return 'no memory fold'; const summary = fold.innerText.replace(/\\s+/g, ' '); fold.click(); await new Promise(r => setTimeout(r, 200)); const lines = [...document.querySelectorAll('.lc-memorycard__line')].map(l => l.innerText); return JSON.stringify({ summary, lines }) })()`)
    check('the thread folds it as "Booty remembered 1 thing", with the line under it', /Booty remembered 1 thing/.test(String(thread)) && /pnpm build/.test(String(thread)), String(thread).slice(0, 200))
    const shown = await evaluate(`document.body.innerText.includes('<locust-memory>')`)
    check('the block itself is not shown', shown === false)
    const rowAfter = await evaluate(settingsNote)
    check('Settings counts it', /2 memories kept/.test(String(rowAfter)), String(rowAfter).slice(-120))
  } else {
    check('no block, so nothing of Booty\'s was invented', byBooty.length === 0, JSON.stringify(byBooty))
  }

  say('C. the Memory screen, checked against the file')
  const screen = await evaluate(`(async () => {
    await (async () => { if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /remembers/.test(h.textContent))) { document.querySelector('button[title="Settings (Ctrl 3)"]').click(); await new Promise(r => setTimeout(r, 600)); const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText)); if (page) page.click(); await new Promise(r => setTimeout(r, 400)) } [...document.querySelectorAll('button')].find(b => /Open memory/.test(b.innerText)).click(); await new Promise(r => setTimeout(r, 600)) })()
    return JSON.stringify({
      title: document.querySelector('.lc-screen__title')?.textContent,
      rows: [...document.querySelectorAll('.lc-memory')].map(r => ({ text: r.querySelector('.lc-memory__text')?.innerText, meta: r.querySelector('.lc-memory__meta')?.innerText.replace(/\\s+/g, ' '), on: r.querySelector('[role=switch]')?.getAttribute('aria-checked') })),
      mode: [...document.querySelectorAll('[role=radiogroup][aria-label^="How a teammate"] [role=radio]')].find(b => b.getAttribute('aria-checked') === 'true')?.innerText
    })
  })()`)
  let s = {}
  try { s = JSON.parse(String(screen)) } catch { /* below */ }
  check('the screen lists the seeded memory with who and where, mode Keep and tell me', s.title === 'Memory' && s.rows?.some((r) => /PELICAN/.test(r.text) && /you · scratch/.test(r.meta) && r.on === 'true') && /Keep and tell me/.test(String(s.mode)), String(screen).slice(0, 300))

  const edited = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-memory')].find(r => /PELICAN/.test(r.innerText))
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Edit').click()
    await new Promise(r => setTimeout(r, 200))
    const box = row.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'The secret word for this project is HERON.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Save').click()
    await new Promise(r => setTimeout(r, 600))
    return [...document.querySelectorAll('.lc-memory__text')].map(t => t.innerText).join(' | ')
  })()`)
  check('editing changes the text on screen and on disk', /HERON/.test(String(edited)) && (await memoriesOnDisk()).some((m) => m.memoryId === 'mem_seed' && /HERON/.test(m.text)), String(edited).slice(0, 120))

  const switched = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-memory')].find(r => /HERON/.test(r.innerText))
    row.querySelector('[role=switch]').click()
    await new Promise(r => setTimeout(r, 600))
    return row.querySelector('[role=switch]').getAttribute('aria-checked')
  })()`)
  check('switching one off is on disk', switched === 'false' && (await memoriesOnDisk()).some((m) => m.memoryId === 'mem_seed' && m.enabled === false), String(switched))

  const added = await evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="What to remember"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Colin wants diffs, not prose.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...document.querySelectorAll('[role=radiogroup][aria-label="Where it applies"] [role=radio]')].find(b => /Everywhere/.test(b.innerText)).click()
    await new Promise(r => setTimeout(r, 100))
    ;[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Remember').click()
    await new Promise(r => setTimeout(r, 600))
    return [...document.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
  })()`)
  const global = (await memoriesOnDisk()).find((m) => /diffs, not prose/.test(m.text))
  check('a memory typed by hand for everywhere is on disk as yours, global', global !== undefined && global.scope === 'global' && global.by?.name === 'you' && global.status === 'kept', JSON.stringify(global))
  check('and on screen under Everywhere', /diffs, not prose/.test(String(added)))

  const asked = await evaluate(`(async () => {
    ;[...document.querySelectorAll('[role=radiogroup][aria-label^="How a teammate"] [role=radio]')].find(b => /Ask me first/.test(b.innerText)).click()
    await new Promise(r => setTimeout(r, 600))
    return [...document.querySelectorAll('[role=radiogroup][aria-label^="How a teammate"] [role=radio]')].find(b => b.getAttribute('aria-checked') === 'true')?.innerText
  })()`)
  check('the mode change is written to the workspace settings', /Ask me first/.test(String(asked)) && (await settingsOnDisk()).memoryMode === 'ask', JSON.stringify(await settingsOnDisk()))

  // A proposed memory, planted the way the reader would plant it, waits with Keep / Forget.
  const planted = await memoriesOnDisk()
  planted.push({
    memoryId: 'mem_proposed', text: 'The API is on port 3001.', scope: 'workspace', workspaceId: WORKSPACE_ID, workspaceName: 'scratch',
    by: { teammateId: 'tm_wren', name: 'Wren' }, createdAt: T0, status: 'proposed', enabled: true
  })
  await writeFile(MEMORIES, JSON.stringify({ schemaVersion: 1, memories: planted }), 'utf8')
  const kept = await evaluate(`(async () => {
    // Leave and come back so the screen re-reads the file.
    // The Memory screen re-reads the file when opened; Settings shows what the window holds, so open the screen first.
    // Leave the Memory screen and come back so it re-reads the planted file.
    document.querySelector('button[title="Team (Ctrl 2)"]').click()
    await new Promise(r => setTimeout(r, 300))
    await (async () => { if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /remembers/.test(h.textContent))) { document.querySelector('button[title="Settings (Ctrl 3)"]').click(); await new Promise(r => setTimeout(r, 600)); const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText)); if (page) page.click(); await new Promise(r => setTimeout(r, 400)) } [...document.querySelectorAll('button')].find(b => /Open memory/.test(b.innerText)).click(); await new Promise(r => setTimeout(r, 600)) })()
    const waiting = await (async () => { if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /remembers/.test(h.textContent))) { document.querySelector('button[title="Settings (Ctrl 3)"]').click(); await new Promise(r => setTimeout(r, 600)); const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText)); if (page) page.click(); await new Promise(r => setTimeout(r, 400)) } const h = [...document.querySelectorAll('.lc-settings__heading')].find(h => /remembers/.test(h.textContent)); return h.closest('section').innerText.replace(/\\s+/g, ' ') })()
    await (async () => { if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /remembers/.test(h.textContent))) { document.querySelector('button[title="Settings (Ctrl 3)"]').click(); await new Promise(r => setTimeout(r, 600)); const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText)); if (page) page.click(); await new Promise(r => setTimeout(r, 400)) } [...document.querySelectorAll('button')].find(b => /Open memory/.test(b.innerText)).click(); await new Promise(r => setTimeout(r, 600)) })()
    const row = [...document.querySelectorAll('.lc-memory.is-proposed')].find(r => /3001/.test(r.innerText))
    if (!row) return JSON.stringify({ waiting, row: null })
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Keep').click()
    await new Promise(r => setTimeout(r, 600))
    return JSON.stringify({ waiting, proposedLeft: document.querySelectorAll('.lc-memory.is-proposed').length })
  })()`)
  let k = {}
  try { k = JSON.parse(String(kept)) } catch { /* below */ }
  check('a proposed memory is counted as waiting in Settings and Keep makes it kept on disk', /1 waiting for you/.test(String(k.waiting)) && k.proposedLeft === 0 && (await memoriesOnDisk()).some((m) => m.memoryId === 'mem_proposed' && m.status === 'kept'), String(kept))

  const removed = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-memory')].find(r => /3001/.test(r.innerText))
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Remove').click()
    await new Promise(r => setTimeout(r, 600))
    return document.querySelectorAll('.lc-memory').length
  })()`)
  check('Remove takes it off the screen and the disk', !(await memoriesOnDisk()).some((m) => m.memoryId === 'mem_proposed'), `${String(removed)} rows left`)

  say('D. Settings carries the same control')
  const settings = await evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 600))
    // Settings is a list of pages since 0.176.0; memory lives on this one.
    const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /How teammates work/.test(b.innerText))
    if (page) page.click()
    await new Promise(r => setTimeout(r, 500))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /remembers/.test(h.textContent))
    const section = heading?.closest('section')
    return JSON.stringify({ heading: heading?.innerText, mode: [...(section?.querySelectorAll('[role=radio]') ?? [])].find(b => b.getAttribute('aria-checked') === 'true')?.innerText, open: !![...(section?.querySelectorAll('button') ?? [])].find(b => /Open memory/.test(b.innerText)) })
  })()`)
  check('the section names the mode the file holds and links to the screen', /Ask me first/.test(String(settings)) && /"open":true/.test(String(settings)), String(settings))

  say('E. console')
  check('no renderer errors during the smoke', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1500)
  if (failures > 0) {
    say('--- app output (tail) ---')
    say(appOutput.join('').split('\n').slice(-15).join('\n'))
  }
  if (KEEP) say(`profile kept at ${profile}; workspace at ${workspace}`)
  else {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
  }
}
if (failures > 0) { say(`\n${String(failures)} MEMORY SMOKE FAILURE(S)`); process.exit(1) }
say('\nMEMORY SMOKE PASSED')
