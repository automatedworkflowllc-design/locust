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
import { join, resolve } from 'node:path'

// Absolute: the app is started from its profile folder, not from here.
const app = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
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
const evaluateOnce = (expression) => new Promise((resolve, reject) => {
  const id = nextId++
  waiting.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
})
// The window may reload once as it finishes starting (a first launch does); the page is asked again.
const evaluate = async (expression) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await evaluateOnce(expression)
    } catch (error) {
      if (attempt >= 5 || !/context was destroyed|Cannot find context/i.test(String(error?.message ?? error))) throw error
      await sleep(1_500)
    }
  }
}

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
    const WORDS = 'Using the shell, run a command that prints the numbers 1 to 300, one per second, then tell me the last number.'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    // The box is found again every time: the window can draw a new one as the
    // conversation opens, and a held reference then reads the old, detached box
    // (0.504's first run: "never ran: start enabled" after the re-press).
    const box = () => document.querySelector('form.command-dock textarea')
    const fill = () => {
      const field = box()
      if (field === null || field.value.length > 0) return
      setter.call(field, WORDS)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (box() === null) return 'no box'
    fill()
    // Pressed again if the words are still in the box: on a runner that has just
    // started, a press can land before the window is listening (0.497, run 36696510212).
    let presses = 0
    let sent = false
    for (let i = 0; i < 80 && presses < 3 && !sent; i += 1) {
      fill()
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled && (box()?.value.length ?? 0) > 0) {
        button.click()
        presses += 1
        for (let wait = 0; wait < 16 && (box()?.value.length ?? 0) > 0; wait += 1) await new Promise((r) => setTimeout(r, 500))
        // Emptied, and a turn on screen: it went. Emptied with nothing on screen: the box was redrawn.
        if ((box()?.value.length ?? 0) === 0 && document.querySelector('.lc-thread .lc-bubble')) sent = true
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    window.__presses = presses
    window.__box = box()?.value ?? '(no box)'
    for (let i = 0; i < 180; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      if (document.querySelector('button[aria-label="Stop the running reply"]') && document.querySelector('.lc-livestep')) return window.__presses > 1 ? 'running (Start pressed ' + window.__presses + ' times)' : 'running'
    }
    const start = document.querySelector('button[aria-label="Send"]')
    return 'never ran: pressed ' + window.__presses + ' times, box held "' + String(window.__box).slice(0, 40) + '" | start ' + (start === null ? 'missing' : start.disabled ? 'disabled (' + (start.getAttribute('title') ?? '') + ')' : 'enabled')
      + ' | notice: ' + ([...document.querySelectorAll('.lc-notice')].map((el) => el.innerText).join(' / ') || 'none')
      + ' | runtimes: ' + (document.querySelector('.lc-sidebar__status, .lc-status')?.innerText ?? '?')
      + ' | thread: ' + (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-400)
  })()`)
  const running = String(sent).startsWith('running')
  check('a turn on the free model starts running', running, String(sent))
  if (!running) {
    // What the window showed, as a picture the workflow keeps.
    const id = nextId++
    const shot = await new Promise((resolve) => {
      waiting.set(id, { resolve: () => undefined, reject: () => undefined })
      const listener = (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== id) return
        socket.removeEventListener('message', listener)
        resolve(message.result?.data)
      }
      socket.addEventListener('message', listener)
      socket.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    })
    if (typeof shot === 'string') await writeFile('mac-smoke.png', Buffer.from(shot, 'base64'))
  }
  // Let the runtime get going: the Stop that matters ends a process tree already doing work.
  // Waited for, not assumed: on a runner just started, OpenCode can take a while to appear.
  let during = []
  const waitedFrom = Date.now()
  for (let second = 0; second < 45 && during.length === 0; second += 1) {
    await sleep(1_000)
    during = opencodes().filter((pid) => !before.has(pid))
  }
  if (during.length > 0) await sleep(6_000)
  during = opencodes().filter((pid) => !before.has(pid))
  console.log(`  opencode processes during the run: ${String(during.length)} (first seen after ${String(Math.round((Date.now() - waitedFrom) / 1000))} s)`)
  if (during.length === 0) console.log(`  every process now: ${execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n').filter((line) => /opencode|Locust/i.test(line)).join(' | ').slice(0, 1200)}`)

  const stopped = await evaluate(`(async () => {
    document.querySelector('button[aria-label="Stop the running reply"]')?.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label="Stop the running reply"]')) return 'stopped'
    }
    return 'still running'
  })()`)
  check('Stop ends the run in the window', stopped === 'stopped', String(stopped))
  await sleep(5_000)
  const left = opencodes().filter((pid) => !before.has(pid) && during.includes(pid))
  // With nothing running there was nothing to stop, and that proves nothing.
  check('Stop ends the whole process group: nothing the run started is left', during.length > 0 && left.length === 0, JSON.stringify({ during, left }))
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
