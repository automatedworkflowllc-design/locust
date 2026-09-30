// Launch the packaged Mac app, run one free turn, press Stop (CI, 0.496).
//
//   node _smoke/mac-stop-smoke.mjs <path to Locust.app/Contents/MacOS/Locust>
//
// The process-group Stop (0.476) was written for macOS and had never run on a
// real Mac: the Windows machine builds and drives everything, and a Mac build
// was only ever made, never started. This runs on GitHub's macOS runner after
// the dmg is built: a teammate on a free OpenCode model is asked for a long,
// slow answer; once it is running, Stop is pressed, and afterwards no
// `opencode` process the run started may be left. Spends nothing (free model;
// LOCUST_FREE_ONLY refuses any other route). Exit 0 only if every check passes.
//
// Self-contained on purpose: the drive library assumes Windows (its paths,
// `electron.exe`, npm's folder), and this has to run where that is untrue.

import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const app = process.argv[2]
if (app === undefined) {
  console.log('usage: node _smoke/mac-stop-smoke.mjs <Locust.app/Contents/MacOS/Locust>')
  process.exit(2)
}
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const PORT = 9333
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' })
/** The `opencode` processes on this machine, by pid. */
const opencodes = () => {
  try {
    return execFileSync('pgrep', ['-f', 'opencode'], { encoding: 'utf8' }).split('\n').map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const workspace = await mkdtemp(join(tmpdir(), 'locust-mac-smoke-ws-'))
git(['init', '-q', '-b', 'main'], workspace)
git(['config', 'user.email', 'smoke@locust.test'], workspace)
git(['config', 'user.name', 'Locust smoke'], workspace)
await writeFile(join(workspace, 'README.md'), '# smoke\n', 'utf8')
git(['add', '.'], workspace)
git(['commit', '-q', '-m', 'first'], workspace)
const profile = await mkdtemp(join(tmpdir(), 'locust-mac-smoke-profile-'))
await writeFile(join(profile, 'teammates.json'), JSON.stringify({
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-30T00:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
}), 'utf8')

const before = new Set(opencodes())
const child = spawn(app, [`--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`, `--workspace=${workspace}`], {
  cwd: profile,
  env: { ...process.env, LOCUST_FREE_ONLY: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
const output = []
child.stdout.on('data', (data) => output.push(String(data)))
child.stderr.on('data', (data) => output.push(String(data)))

let socket
let nextId = 1
const waiting = new Map()
const evaluate = (expression) => new Promise((resolve, reject) => {
  const id = nextId++
  waiting.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
})

try {
  let page
  for (let i = 0; i < 120 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`the app exited ${String(child.exitCode)}: ${output.join('').slice(-600)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl && !target.url.includes('#splash'))
    } catch { /* not listening yet */ }
  }
  check('the packaged app starts on macOS and opens its window', page !== undefined)
  if (page === undefined) throw new Error('no window')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const held = waiting.get(message.id)
    if (held === undefined) return
    waiting.delete(message.id)
    if (message.error !== undefined) held.reject(new Error(message.error.message))
    else held.resolve(message.result?.result?.value)
  })
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

  const opened = await evaluate(`(async () => {
    for (let i = 0; i < 60; i += 1) {
      const face = [...document.querySelectorAll('.lc-faces__one')].find((one) => (one.getAttribute('aria-label') ?? '').startsWith('Ash — '))
      if (face) { face.click(); await new Promise((r) => setTimeout(r, 800)); return 'opened' }
      await new Promise((r) => setTimeout(r, 500))
    }
    return 'no face: ' + (document.body.innerText ?? '').slice(0, 200)
  })()`)
  check("Ash's conversation opens", opened === 'opened', String(opened))

  const sent = await evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'no box'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Using the shell, run a command that prints the numbers 1 to 300, one per second, then tell me the last number.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) {
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
      await new Promise((r) => setTimeout(r, 250))
    }
    for (let i = 0; i < 180; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      if (document.querySelector('button[aria-label="Stop the running mission"]') && document.querySelector('.lc-livestep')) return 'running'
    }
    return 'never ran: ' + (document.querySelector('.lc-thread')?.innerText ?? '').slice(-300)
  })()`)
  check('a turn on the free model starts running', sent === 'running', String(sent))
  // Let the runtime get going: the Stop that matters ends a process tree already doing work.
  await sleep(12_000)
  const during = opencodes().filter((pid) => !before.has(pid))
  console.log(`  opencode processes during the run: ${String(during.length)}`)

  const stopped = await evaluate(`(async () => {
    document.querySelector('button[aria-label="Stop the running mission"]')?.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label="Stop the running mission"]')) return 'stopped'
    }
    return 'still running'
  })()`)
  check('Stop ends the run in the window', stopped === 'stopped', String(stopped))
  await sleep(5_000)
  const left = opencodes().filter((pid) => !before.has(pid) && during.includes(pid))
  check('Stop ends the whole process group: nothing the run started is left', left.length === 0, JSON.stringify({ during, left }))
} catch (error) {
  failures += 1
  console.log(`smoke failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { socket?.close() } catch { /* closed */ }
  child.kill()
  await sleep(1_000)
}
console.log(failures === 0 ? 'MAC STOP SMOKE PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
