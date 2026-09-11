// Update smoke: the packaged build asks the real release channel and gets an
// answer it can act on.
//
//   node _smoke/update-smoke.mjs
//
// Runs the built Locust.exe, opens Settings, clicks the update check, and
// waits for the line to settle. A build whose version matches the newest
// release must say "Up to date."; a build behind it must name the version it
// found. Either proves the channel: the repository is reachable, latest.yml
// parses, and the app is comparing against what was actually published.
// "The update check could not complete." is the failure this exists to
// catch -- it is what an empty or unreachable channel looks like.
//
// Needs network. Costs no provider quota.
//
//   node _smoke/update-smoke.mjs --installed
//
// runs the INSTALLED copy under %LOCALAPPDATA% on its real profile instead
// of the fresh build, which is the only way to see a real upgrade offered:
// an installed build behind the newest release must report the version it
// found and download it. Nothing is installed by this smoke -- installing
// restarts the app, and that is the person's click.
//
//   node _smoke/update-smoke.mjs --installed --install
//
// goes one step further: it clicks Install and restart, waits for the app
// to quit, and then reads the installed binary's version. This is the check
// that was missing on 2026-09-03, when five releases sat downloaded while
// the installed copy stayed at 0.9.1 and every 'Up to date' smoke ran the
// packaged build from release/ rather than the installed one.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { portFor } from './ports.mjs'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const INSTALLED = process.argv.includes('--installed')
const INSTALL = process.argv.includes('--install') && INSTALLED
const EXE = INSTALLED
  ? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Locust', 'Locust.exe')
  : join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
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
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve })),
      sleep(360_000).then(() => ({ error: { message: 'cdp timeout' } }))
    ])
  }
  async eval(expression) {
    const message = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (message.error) throw new Error(JSON.stringify(message.error))
    const result = message.result
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return result?.result?.value
  }
}

// The installed copy keeps its own profile: that is the point of running it.
const profile = INSTALLED ? undefined : await mkdtemp(join(tmpdir(), 'locust-update-smoke-'))
if (profile !== undefined) await mkdir(profile, { recursive: true })
const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, ...(profile === undefined ? [] : [`--user-data-dir=${profile}`])], {
  cwd: APP_DIR,
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the packaged app opens')
  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // not yet
    }
  }
  check('the renderer is up', page !== undefined, child.exitCode === null ? undefined : `app exited ${child.exitCode}`)
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

  say('2. open Settings and ask for an update')
  const result = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i += 1) {
      if (document.querySelector('.lc-brand__wordmark')) break
      await new Promise(r => setTimeout(r, 250))
    }
    const settings = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Settings')
    if (!settings) return JSON.stringify({ opened: false })
    settings.click()
    let heading
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => h.innerText.trim() === 'Updates')
      if (heading) break
    }
    if (!heading) return JSON.stringify({ opened: true, section: false })
    const section = heading.closest('.lc-settings__section')
    const note = () => (section.querySelector('.lc-settings__note') || { innerText: '' }).innerText.trim()
    const before = note()
    const button = section.querySelector('button')
    if (!button) return JSON.stringify({ opened: true, section: true, before, button: false })
    const version = (document.body.innerText.match(/Locust\\s+(\\d+\\.\\d+\\.\\d+)/) || [])[1] || ''
    button.click()
    // Wait for the check to leave "Checking…" and settle on an answer.
    let line = ''
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      line = note()
      if (/Up to date|ready to install|could not complete/.test(line)) break
    }
    return JSON.stringify({ opened: true, section: true, before, button: true, buttonLabel: button.innerText.trim(), version, line })
  })()`)
  const state = JSON.parse(result)
  check('Settings opened to an Updates section', state.opened === true && state.section === true, result)
  say(`       build: ${state.version || '(not shown)'} · before: ${state.before} · after: ${state.line}`)
  check('the check settled on an answer', typeof state.line === 'string' && state.line.length > 0 && !/Checking/.test(state.line), state.line)
  check('the channel answered rather than failing', !/could not complete/i.test(state.line ?? ''), state.line)
  check(
    'the answer is one of the two the channel can give',
    /^Up to date\.$/.test(state.line ?? '') || /ready to install/.test(state.line ?? ''),
    state.line
  )
  if (INSTALLED) {
    const latest = await (await fetch('https://github.com/automatedworkflowllc-design/locust-releases/releases/latest/download/latest.yml')).text()
    const newest = (latest.match(/^version:\s*(\S+)/m) || [])[1]
    say(`       newest release: ${newest ?? '(unreadable)'}`)
    if (newest !== undefined && newest !== state.version) {
      check('an installed build behind the newest release downloads it and says so', new RegExp(`Version ${newest.replace(/[.]/g, '[.]')} is downloaded and ready to install`).test(state.line ?? ''), state.line)
      if (INSTALL) {
        say('3. click Install and restart, and read the binary that comes back')
        const clicked = await cdp.eval(`(() => {
          const button = [...document.querySelectorAll('button')].find(b => /Install and restart/.test(b.innerText))
          if (!button) return 'no button'
          button.click()
          return 'clicked'
        })()`).catch(() => 'clicked (page went away)')
        check('the Install button was there to click', clicked !== 'no button', clicked)
        // The app quits, the installer runs, the app comes back. Wait for the
        // process we launched to exit, then for the installed version to move.
        for (let i = 0; i < 120 && child.exitCode === null; i += 1) await sleep(1000)
        check('the app quit to install', child.exitCode !== null, `exit ${String(child.exitCode)}`)
        // Read the binary directly rather than shelling out: a PowerShell
        // path in a template literal lost its backslashes once already and
        // reported "installed " against a copy that had in fact updated
        // correctly, which is a false alarm on the one check this smoke
        // exists for. EXE is the same path this smoke launched.
        const { execFileSync } = await import('node:child_process')
        // Single quotes: PowerShell takes backslashes literally inside them,
        // so the path arrives intact. Doubling any quote is the escape.
        const quoted = `'${EXE.replace(/'/g, "''")}'`
        const versionOf = () =>
          execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath ${quoted}).VersionInfo.FileVersion`],
            { encoding: 'utf8' }
          ).trim()
        let after = state.version
        for (let i = 0; i < 90; i += 1) {
          await sleep(2000)
          try {
            after = versionOf()
          } catch {
            // mid-install; the exe is being replaced
          }
          if (after === newest) break
        }
        check('the installed copy is now the newest release', after === newest, `installed ${after}, newest ${newest}`)
        // The installer relaunches the app; close it so the machine is left as found.
        try {
          execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process Locust -ErrorAction SilentlyContinue | Stop-Process -Force'], { encoding: 'utf8' })
        } catch {
          // nothing to close
        }
      }
    } else {
      check('an installed build at the newest release is up to date', /^Up to date\.$/.test(state.line ?? ''), state.line)
      if (INSTALL) say('       (already newest; nothing to install)')
    }
  }
} finally {
  child.kill()
  await sleep(500)
  if (profile !== undefined) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

console.error(failures === 0 ? '\nUPDATE SMOKE PASSED' : `\n${failures} UPDATE SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
