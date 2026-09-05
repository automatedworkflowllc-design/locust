// Renderer smoke: launch the built Electron app, attach to its renderer over
// CDP, run a real Codex mission through the UI the way a person would, and
// assert on what the SCREEN says -- not on what the main process returned.
//
// The adapter smoke proves a live provider run round-trips the durable ledger.
// This proves the last hop: the renderer is told, and shows it.
//
//   node _smoke/renderer-smoke.mjs
//
// Exits non-zero on any failed assertion. Always kills the app on the way out.
//
// The expected answer is COMPUTED, not quoted. An instructed token ("reply with
// RENDERER_OK") is echoed back in the prompt the UI displays, so matching it on
// screen would pass with no model in the loop at all -- a check that cannot go
// red. The prompt asks for 6137 x 4 instead: 24548 appears on screen only if a
// model actually answered. The pre-flight assertion below pins that.

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9223
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'

const PROMPT = 'Reply with exactly the digits of 6137 multiplied by 4, and nothing else.'
const ANSWER = '24548'

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
    // Every call is bounded. A hung evaluate must fail the run, not stall it.
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve })),
      sleep(180_000).then(() => ({ error: { message: 'cdp timeout' } }))
    ])
  }
  async eval(expression) {
    const message = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (message.error) throw new Error(JSON.stringify(message.error))
    const result = message.result
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    }
    return result?.result?.value
  }
}

// A private userData dir per run. The app restores mission history from its
// durable ledger on launch, so a shared profile puts the PREVIOUS run's answer
// on screen before this one starts -- which silently defeats the pre-flight
// control below and would let a broken build pass on a stale receipt.
const profile = await mkdtemp(join(tmpdir(), 'locust-renderer-smoke-'))
const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts and exposes a renderer')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // devtools endpoint not listening yet
    }
  }
  check('renderer target available', page !== undefined,
    child.exitCode === null ? undefined : `app exited ${child.exitCode}`)
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

  say('2. React has rendered the composer')
  // Wait for the dock to EXIST -- not for its send button to be enabled. Send
  // is correctly disabled while the prompt is empty, so waiting on enablement
  // here is a condition that can never go green. Enablement is asserted at
  // step 3 instead, where it means something: it is the visible proof that the
  // typed value reached component state rather than only the DOM node.
  const composerReady = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i += 1) {
      if (document.querySelector('form.command-dock textarea') &&
          document.querySelector('form.command-dock .send-button')) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('composer is on screen', composerReady === true)

  // Send stays disabled until runtime discovery reports Codex ready, so typing
  // before that races the probe and submits nothing.
  const runtimeReady = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i += 1) {
      // The shell's own vocabulary: a discovered, usable runtime renders a
      // READY tag. Word-bounded so ALREADY cannot satisfy it. The escapes are
      // doubled because this regex lives inside a template literal, where a
      // single backslash-b is a backspace character.
      if (/\\bREADY\\b/.test(document.body.innerText)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  check('runtime discovery reports Codex ready', runtimeReady === true)

  // The vendored-font catch, proven rather than assumed. The reference design
  // fetches Geist from Google; this app's CSP pins font-src to 'self' and
  // packaged builds block renderer egress, so a fetched face would silently
  // fall back to Helvetica on every real install. document.fonts.check is the
  // only honest way to tell those apart -- the page looks plausible either way.
  // Force the load rather than reading status: @font-face is lazy, so a face no
  // rendered element has asked for yet reports `unloaded` even when the file is
  // perfectly good. What must be proven here is that the file is REACHABLE and
  // CSP-legal from inside the renderer; whether the shell has adopted it is a
  // separate assertion, made once the new components render.
  const fonts = await cdp.eval(`(async () => {
    const wanted = ['400 13px Geist', '500 13px Geist', '400 11px "Geist Mono"']
    const results = {}
    for (const spec of wanted) {
      try {
        const faces = await document.fonts.load(spec)
        results[spec] = faces.length > 0 && faces.every(f => f.status === 'loaded')
      } catch (error) {
        results[spec] = 'threw: ' + String(error && error.message)
      }
    }
    return JSON.stringify({
      results,
      sans: results['400 13px Geist'] === true && results['500 13px Geist'] === true,
      mono: results['400 11px \"Geist Mono\"'] === true
    })
  })()`)
  const fontState = JSON.parse(fonts)
  check('vendored Geist loaded from disk, not the network', fontState.sans === true, fonts)
  check('vendored Geist Mono loaded', fontState.mono === true)

  const detected = await cdp.eval(`(() => {
    const text = document.body.innerText
    const version = /v(\\d+\\.\\d+\\.\\d+[^\\s]*)/.exec(text)
    return JSON.stringify({ runtimeReady: /\\bREADY\\b/.test(text), version: version && version[1] })
  })()`)
  say(`       ${detected}`)

  // Pre-flight control: the answer must be absent BEFORE the run, or the
  // assertion at step 4 proves nothing.
  const before = await cdp.eval('document.body.innerText')
  check(`CONTROL: "${ANSWER}" is not on screen before the run`, !before.includes(ANSWER))

  say('3. drive a real mission through the UI')
  const submitted = await cdp.eval(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    // React tracks the node's previous value; going through the native setter
    // is what makes a programmatic change look like typing.
    const send = document.querySelector('form.command-dock .send-button')
    const disabledEmpty = send.disabled
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    const enabledWithPrompt = !send.disabled
    send.click()
    // Poll for the clear rather than sleeping a fixed interval: the composer
    // clears when the start IPC resolves, and how long the host takes to spawn
    // a real provider process is not something this assertion should encode.
    let cleared = false
    for (let i = 0; i < 40; i += 1) {
      if (field.value === '') { cleared = true; break }
      await new Promise(r => setTimeout(r, 250))
    }
    return JSON.stringify({
      disabledEmpty,
      enabledWithPrompt,
      cleared,
      // The title bar's run counter is the shell's live indicator.
      live: /\\d+ running/.test(document.body.innerText)
    })
  })()`)
  const state = JSON.parse(submitted)
  check('send is disabled with an empty prompt and enabled once typed',
    state.disabledEmpty === true && state.enabledWithPrompt === true,
    `empty=${state.disabledEmpty} typed=${state.enabledWithPrompt}`)
  check('composer cleared on submit (React state was reached)', state.cleared === true)
  check('the shell switched to the live-runtime banner', state.live === true)

  say('4. what the screen says when it finishes')
  const finished = await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const text = document.body.innerText
      if (/\\u00b7 (completed|failed|cancelled) \\u00b7|interrupted/.test(text)) {
        await new Promise(r => setTimeout(r, 1200))
        return document.body.innerText
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return document.body.innerText
  })()`)
  check('the model answer reached the screen', finished.includes(ANSWER))
  check('the mission reads as complete', /· completed ·/.test(finished))
  check('the screen does not report a failed or interrupted run',
    !/interrupted|· failed ·/.test(finished))
  // The header states the sandbox the run ACTUALLY had, and the composer's
  // default mode is Accept edits, so it says so. This asserted `read-only`
  // from the days when the app ran one fixed read-only route, and had been
  // failing on a correct app ever since (Codex sweep, 2026-09-05).
  check(
    'the run was labelled with the containment it actually had',
    /may edit the workspace/.test(finished) && !/read-only/.test(finished),
    /may edit the workspace/.test(finished) ? 'may edit the workspace' : 'neither phrase on screen'
  )

  say(`       ...${finished.trim().slice(-240)}`)

  say(`\n${failures === 0 ? 'RENDERER SMOKE PASSED' : `RENDERER SMOKE FAILED (${failures})`}`)
} finally {
  child.kill()
  await sleep(500)
  if (child.exitCode === null) child.kill('SIGKILL')
  await rm(profile, { recursive: true, force: true })
  const noise = appOutput.join('').trim()
  if (noise.length > 0) say(`\napp output:\n${noise.slice(0, 1500)}`)
}

process.exit(failures === 0 ? 0 : 1)
