// The app says what changed, once.
//
//   node _tools/changelog-drive.mjs
//
// Colin, 2026-09-17: is there a changelog on GitHub, in the app, on the site?
// The app was the one that said nothing at all -- it downloaded a version,
// installed it at quit, and came back looking identical. This checks the
// three things that had to become true:
//
//   1. On the first launch of a version, the workroom says so and the entry
//      can be read without leaving the screen.
//   2. Settings carries the same entry permanently, under Updates.
//   3. The SECOND launch says nothing, because the version is no longer new.
//
// The profile is reused between the two launches on purpose: that is the
// whole test. No provider run; costs nothing.

import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9487

let failures = 0
const check = (label, ok, detail) => {
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
      waiter(message)
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve) => this.pending.set(id, resolve))
  }
  async eval(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text)
    return reply.result?.result?.value
  }
}

const workspace = await mkdtemp(join(tmpdir(), 'locust-changelog-ws-'))
await writeFile(join(workspace, 'README.md'), 'scratch\n', 'utf8')
const profile = await mkdtemp(join(tmpdir(), 'locust-changelog-'))
await writeFile(join(profile, 'teammates.json'), JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, autoMode: false } }))

const launch = async () => {
  const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up yet */ }
  }
  if (page === undefined) { child.kill(); throw new Error('no renderer target') }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.eval(`(async () => { for (let i = 0; i < 240; i += 1) { const c = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox'); if (c && /cursor|codex|claude|opencode/i.test(c.innerText)) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)
  return { child, cdp }
}

const version = JSON.parse(await readFile(join(APP_DIR, 'package.json'), 'utf8')).version

let first
try {
  say(`1. first launch on ${version}: the workroom says what changed`)
  first = await launch()
  const banner = await first.cdp.eval(`(async () => {
    for (let i = 0; i < 40; i += 1) {
      const node = document.querySelector('.lc-whatchanged__banner')
      if (node) {
        const read = [...node.querySelectorAll('button')].find(b => /Read it/.test(b.innerText || ''))
        if (read) read.click()
        await new Promise(r => setTimeout(r, 500))
        const after = document.querySelector('.lc-whatchanged__banner')
        return JSON.stringify({
          shown: true,
          text: (after ? after.innerText : '').replace(new RegExp('[' + String.fromCharCode(32, 9, 13, 10) + ']+', 'g'), ' ').slice(0, 200),
          entry: !!document.querySelector('.lc-whatchanged')
        })
      }
      await new Promise(r => setTimeout(r, 250))
    }
    return JSON.stringify({ shown: false })
  })()`)
  const one = JSON.parse(banner)
  say(`   ${banner}`)
  check('the banner is there on a version never opened before', one.shown === true)
  check('it names the version', String(one.text).includes(version), String(one.text).slice(0, 80))
  check('and the entry itself can be read in place', one.entry === true)

  say('2. Settings carries the same entry, permanently')
  const settings = await first.cdp.eval(`(async () => {
    const s = [...document.querySelectorAll('button')].find(b => /^Settings/.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''))
    if (s) s.click()
    await new Promise(r => setTimeout(r, 700))
    const page = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /This app/.test(b.innerText || ''))
    if (page) page.click()
    await new Promise(r => setTimeout(r, 600))
    const head = [...document.querySelectorAll('.lc-settings__subheading')].find(h => /What changed/.test(h.innerText || ''))
    const body = document.querySelector('.lc-whatchanged')
    return JSON.stringify({
      heading: head ? head.innerText.trim() : null,
      body: (body ? body.innerText : '').replace(new RegExp('[' + String.fromCharCode(32, 9, 13, 10) + ']+', 'g'), ' ').slice(0, 160)
    })
  })()`)
  const two = JSON.parse(settings)
  say(`   ${settings}`)
  check('Settings names the version it is describing', String(two.heading).includes(version), String(two.heading))
  check('and shows the entry, not an apology', String(two.body).length > 30, String(two.body).slice(0, 90))
} finally {
  first?.child.kill()
  await sleep(1500)
}

let second
try {
  say('3. second launch on the same version: nothing is announced')
  second = await launch()
  const again = await second.cdp.eval(`(async () => {
    await new Promise(r => setTimeout(r, 2500))
    return JSON.stringify({ banner: !!document.querySelector('.lc-whatchanged__banner') })
  })()`)
  say(`   ${again}`)
  check('the banner does not come back', JSON.parse(again).banner === false)
  const seen = JSON.parse(await readFile(join(profile, 'seen-version.json'), 'utf8'))
  check('the version was written down', seen.version === version, JSON.stringify(seen))
} finally {
  second?.child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

console.error(failures === 0 ? 'CHANGELOG DRIVE PASSED' : `${String(failures)} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
