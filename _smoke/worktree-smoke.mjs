// Do two teammates on their own branches stay out of each other's way?
//
//   node _smoke/worktree-smoke.mjs
//
// A scratch git repository with one committed file; two seeded teammates on
// the FREE OpenCode model, both with "Own branch" on, both told to append a
// line to the same file. What the host owes, asserted strictly: each run
// happens in that teammate's own worktree (git knows both trees, on
// locust/wren and locust/booty), the main checkout is untouched, and the
// sidebar says which branch each is on. Whether a free model actually
// edits is the model's business: the file contents are checked when a
// tree changed, and logged when it did not.

import { spawn, execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
const git = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
})
try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) { say(`  [FAIL] something is already debugging on port ${String(PORT)}`); process.exit(1) }
} catch { /* free */ }

const workspace = await mkdtemp(join(tmpdir(), 'locust-worktree-ws-'))
await git(['init', '-q', '-b', 'main'], workspace)
await git(['config', 'user.email', 'smoke@locust.test'], workspace)
await git(['config', 'user.name', 'Locust smoke'], workspace)
await writeFile(join(workspace, 'NOTES.md'), '# notes\n', 'utf8')
await git(['add', 'NOTES.md'], workspace)
await git(['commit', '-q', '-m', 'first'], workspace)
const profile = await mkdtemp(join(tmpdir(), 'locust-worktree-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
const T0 = '2026-09-05T05:00:00.000Z'
const route = { runtime: 'opencode', model: FREE_MODEL, mode: 'accept-edits' }
await writeFile(join(profile, 'teammates.json'), JSON.stringify({
  schemaVersion: 1,
  teammates: [
    { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route, worktree: true },
    { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: T0, route, worktree: true }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 6, memoryMode: 'off' }
}))

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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
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

  say('1. the app starts; the sidebar says each teammate is on its own branch')
  const ready = await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('discovery finished', ready === true)
  const sidebar = await evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ')`)
  check('the sidebar reads "on locust/wren" and "on locust/booty"', /on locust\/wren/.test(String(sidebar)) && /on locust\/booty/.test(String(sidebar)), String(sidebar).slice(0, 200))

  const ask = async (name) => evaluate(`(async () => {
    let who; for (let i = 0; i < 40 && !who; i += 1) { who = [...document.querySelectorAll('button')].find(b => (b.querySelector('.lc-row__name') || { innerText: '' }).innerText.trim().startsWith("${name}")) || [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') || b.getAttribute('aria-label') || '').startsWith("${name}" + ' ')); if (!who) await new Promise(r => setTimeout(r, 250)) }
    who.click()
    await new Promise(r => setTimeout(r, 400))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Using your file-editing tool, append one line to NOTES.md that says exactly: ${name.toLowerCase()} was here. Then reply with the single word DONE. Do not ask me anything.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'started' }
    }
    return 'no send'
  })()`)
  const settle = () => evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'finished'
    }
    return 'still running'
  })()`)

  say('2. Wren, then Booty, each told to append to NOTES.md')
  check('Wren started', (await ask('Wren')) === 'started')
  check('Wren finished', (await settle()) === 'finished')
  check('Booty started', (await ask('Booty')) === 'started')
  check('Booty finished', (await settle()) === 'finished')
  await sleep(1500)

  say('3. what git and the disk say')
  const trees = await git(['worktree', 'list', '--porcelain'], workspace)
  check('git knows both worktrees, on their own branches', /locust\/wren/.test(trees) && /locust\/booty/.test(trees) && /\.locust[\\/]worktrees[\\/]tm_wren/.test(trees.replace(/\\/g, '/')) , trees.replace(/\s+/g, ' ').slice(0, 300))
  const root = await readFile(join(workspace, 'NOTES.md'), 'utf8')
  check('the main checkout is untouched', root === '# notes\n', JSON.stringify(root))
  check('the main checkout has nothing untracked (.locust is excluded)', (await git(['status', '--porcelain'], workspace)).trim() === '')
  const wren = await readFile(join(workspace, '.locust', 'worktrees', 'tm_wren', 'NOTES.md'), 'utf8').catch(() => '')
  const booty = await readFile(join(workspace, '.locust', 'worktrees', 'tm_booty', 'NOTES.md'), 'utf8').catch(() => '')
  say(`       wren tree: ${JSON.stringify(wren)} · booty tree: ${JSON.stringify(booty)} (model behaviour, informational)`)
  if (/wren/.test(wren) || /booty/.test(booty)) {
    check('a tree that changed changed only for its own teammate', !/booty/.test(wren) && !/wren/.test(booty))
  }

  say('4. the record says the missions belong to the FOLDER, not the tree')
  const { readdir } = await import('node:fs/promises')
  const names = (await readdir(join(profile, 'mission-ledger'))).filter((n) => n.endsWith('.jsonl'))
  const ids = new Set()
  for (const name of names) {
    const first = JSON.parse((await readFile(join(profile, 'mission-ledger', name), 'utf8')).split('\n')[0] ?? '{}')
    ids.add(first.metadata?.workspaceId)
  }
  check('both missions carry one workspace id', names.length === 2 && ids.size === 1, `${String(names.length)} ledgers, ${String(ids.size)} id(s)`)

  say('5. Settings lists both trees; Remove takes one away and keeps its branch')
  const settings = JSON.parse(await evaluate(`(async () => {
    if (![...document.querySelectorAll('.lc-settings__heading')].some(h => /Project folder/.test(h.innerText))) {
      document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    }
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelectorAll('.lc-worktreerow').length >= 2) break
    }
    const rows = [...document.querySelectorAll('.lc-worktreerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())
    const booty = [...document.querySelectorAll('.lc-worktreerow')].find(r => /Booty/.test(r.innerText))
    const remove = booty && [...booty.querySelectorAll('button')].find(b => b.innerText.trim() === 'Remove')
    if (remove) remove.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelectorAll('.lc-worktreerow').length === 1) break
    }
    return JSON.stringify({ rows, after: [...document.querySelectorAll('.lc-worktreerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()) })
  })()`))
  check('Settings listed both, each with its branch', settings.rows.length === 2 && settings.rows.some((r) => /Wren.*locust\/wren/.test(r)) && settings.rows.some((r) => /Booty.*locust\/booty/.test(r)), JSON.stringify(settings.rows))
  check('after Remove only Wren\'s tree is listed', settings.after.length === 1 && /Wren/.test(settings.after[0] ?? ''), JSON.stringify(settings.after))
  const treesAfter = await git(['worktree', 'list', '--porcelain'], workspace)
  check('git agrees: one Locust tree left', /tm_wren/.test(treesAfter.replace(/\\/g, '/')) && !/tm_booty/.test(treesAfter.replace(/\\/g, '/')), treesAfter.replace(/\s+/g, ' ').slice(0, 200))
  check('the removed tree\'s branch stays', /locust\/booty/.test(await git(['branch', '--list', 'locust/booty'], workspace)))
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}
if (failures > 0) { say(`\n${String(failures)} WORKTREE SMOKE FAILURE(S)`); process.exit(1) }
say('\nWORKTREE SMOKE PASSED')
