// Packaged smoke: the built Locust.exe, not the dev tree.
//
//   node _smoke/packaged-smoke.mjs
//
// A packaged Electron app is a different animal from `electron .`: it runs
// from an asar, `app.isPackaged` is true, and this build denies ALL renderer
// network egress in that state. So the checks worth making here are the ones
// packaging can break on its own -- the window opens, the renderer boots with
// its fonts and brand assets out of the asar, discovery still finds the local
// CLIs, and the egress block is really on.
//
// It deliberately runs no provider mission: that costs quota and is already
// covered by the other smokes against the same code.

import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const PORT = 9230
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'

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
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve })),
      sleep(120_000).then(() => ({ error: { message: 'cdp timeout' } }))
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

try {
  await access(EXE)
} catch {
  say(`no packaged build at ${EXE} -- run \`pnpm --filter @teammate/desktop package\` first`)
  process.exit(1)
}

const profile = await mkdtemp(join(tmpdir(), 'locust-packaged-'))
// Deliberately a BARE PATH: no CLI directories added. A packaged app launched
// from the Start menu inherits no shell profile, and this build reported both
// runtimes as missing on a machine where both were installed and working.
// Discovery has to find them where their installers actually put them.
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  env: { ...process.env, PATH: 'C:\\Windows\\System32' },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the packaged app opens a window')
  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // devtools not listening yet
    }
  }
  check('the renderer is up', page !== undefined, child.exitCode === null ? undefined : `exited ${child.exitCode}`)
  if (page === undefined) {
    say(appOutput.join('').slice(-2000))
    process.exit(1)
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')

  say('2. it is really the packaged build, and it says Locust')
  const identity = await cdp.eval(`JSON.stringify({
    title: document.title,
    url: location.protocol,
    brand: document.querySelector('.lc-brand__wordmark') !== null
  })`)
  const id = JSON.parse(identity)
  check('the window is titled Locust', id.title === 'Locust', id.title)
  // A packaged renderer loads from file:, not from the dev server.
  check('the renderer loads from the packaged bundle', id.url === 'file:', id.url)
  check('the brand wordmark rendered from the asar', id.brand === true)

  say('3. the shell boots and discovery still finds the local CLIs')
  const ready = await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const field = document.querySelector('form.command-dock textarea')
      if (field && !/Checking local runtimes/.test(field.placeholder)) {
        return JSON.stringify({
          placeholder: field.placeholder,
          runtimes: [...document.querySelectorAll('.lc-runtimerow, .lc-sidebar__runtimes .lc-row')].map(n => n.innerText.replace(/\\s+/g, ' ').trim()),
          body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)
        })
      }
      await new Promise(r => setTimeout(r, 250))
    }
    return JSON.stringify({ placeholder: 'never finished discovery' })
  })()`)
  const shell = JSON.parse(ready)
  say(`       ${shell.body ?? ''}`.slice(0, 200))
  check('discovery finished', !/never finished/.test(shell.placeholder), shell.placeholder)
  check('a runtime is reported as usable', /READY|Ready/.test(shell.body ?? ''), (shell.body ?? '').slice(0, 160))
  // Both, by name: "not found" for an installed CLI is the bug this pins.
  // Whitespace is normalised in Node, never inside the injected string: a
  // `\s` written into a template literal collapses to `s` and would quietly
  // delete every letter s from the text under test.
  const rawRuntimeText = await cdp.eval(`(() => {
    const open = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (open) open.click()
    return document.body.innerText
  })()`)
  const runtimeText = String(rawRuntimeText).replace(/\s+/g, ' ')
  check('Codex CLI is found without help from PATH', !/Codex[^.]{0,40}not (found|installed)/i.test(runtimeText), runtimeText.slice(0, 200))
  check('Claude Code is found without help from PATH', !/Claude[^.]{0,40}not (found|installed)/i.test(runtimeText), runtimeText.slice(0, 200))

  say('4. CONTROL: the packaged renderer has no network egress')
  // The main process cancels every http(s)/ws request when packaged. If this
  // ever silently regressed, a packaged build would be able to phone out.
  const egress = await cdp.eval(`fetch('https://example.com', { mode: 'no-cors' }).then(() => 'allowed').catch(() => 'blocked')`)
  check('an outbound request from the renderer is refused', egress === 'blocked', egress)

  say('5. the fonts came out of the asar, so the shell is not falling back')
  const fonts = await cdp.eval(`(async () => {
    await document.fonts.ready
    return JSON.stringify([...document.fonts].map(f => f.family).filter((v, i, a) => a.indexOf(v) === i))
  })()`)
  const families = JSON.parse(fonts)
  check('the brand typefaces loaded', families.length > 0, JSON.stringify(families))
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-2000))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\npackaged smoke passed')
