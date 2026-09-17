// Settings as pages, from where the person stands.
//
//   node _tools/settings-drive.mjs
//
// Colin, 2026-09-17: "rework our settings to be like claude codes, ours is a
// literal disaster." It was five areas in one column, so four of them were
// below the fold. This checks the shape that replaced it: a list of pages, one
// page drawn beside it, and a search that finds a setting by its own name.
//
// No provider run; costs nothing.

import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9485

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

const workspace = await mkdtemp(join(tmpdir(), 'locust-settings-'))
const profile = await mkdtemp(join(tmpdir(), 'locust-settings-profile-'))
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, 'README.md'), 'Scratch workspace.\n', 'utf8')
await writeFile(join(profile, 'teammates.json'), JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, autoMode: false } }))

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('#splash'))
    } catch { /* not up yet */ }
  }
  if (page === undefined) { say(appOutput.join('')); throw new Error('no renderer target') }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.eval(`(async () => { for (let i = 0; i < 240; i += 1) { const c = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox'); if (c && /cursor|codex|claude|opencode/i.test(c.innerText)) return true; await new Promise(r => setTimeout(r, 500)) } return false })()`)

  say('1. Settings opens on a list of pages')
  const opened = await cdp.eval(`(async () => {
    const s = [...document.querySelectorAll('button')].find(b => /^Settings/.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''))
    if (s) s.click()
    await new Promise(r => setTimeout(r, 900))
    const nav = [...document.querySelectorAll('.lc-settings__navitem')].map(b => b.innerText.trim())
    const current = document.querySelector('.lc-settings__navitem.is-current')
    const headings = [...document.querySelectorAll('.lc-settings__heading')].map(h => h.innerText.trim())
    return JSON.stringify({ nav, current: current ? current.innerText.trim() : null, headings })
  })()`)
  const first = JSON.parse(opened)
  say(`   ${opened}`)
  check('every page is listed', first.nav.length === 5, first.nav.join(' | '))
  check('one of them is marked as where you are', first.current === 'Your workspace', String(first.current))
  check('only that page is drawn', first.headings.join(',') === 'Project folder,Teammates', first.headings.join(','))

  // Asked because the first after-frame LOOKED as though one heading were
  // tinted. Same class, same markup, so either the screenshot was lying or
  // something in the cascade was; this settles it either way, and keeps it
  // settled.
  const headingColours = await cdp.eval(`(() => {
    const seen = [...document.querySelectorAll('.lc-settings__heading')].map(h => getComputedStyle(h).color)
    return JSON.stringify([...new Set(seen)])
  })()`)
  check('every heading on a page is the same colour', JSON.parse(headingColours).length === 1, headingColours)

  say('2. another page is one press away')
  const switched = await cdp.eval(`(async () => {
    const item = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /This app/.test(b.innerText))
    if (!item) return JSON.stringify({ found: false })
    item.click()
    await new Promise(r => setTimeout(r, 500))
    const headings = [...document.querySelectorAll('.lc-settings__heading')].map(h => h.innerText.trim())
    const scrolled = document.querySelector('.lc-settings__pane')
    return JSON.stringify({ found: true, headings, scrollTop: scrolled ? scrolled.scrollTop : -1 })
  })()`)
  const two = JSON.parse(switched)
  say(`   ${switched}`)
  check('the page changed', two.headings.includes('Trash'), two.headings.join(','))
  check('and the workspace page is no longer drawn', !two.headings.includes('Project folder'))
  check('it opens at the top, not mid-scroll', two.scrollTop === 0, String(two.scrollTop))

  say('3. search finds a setting by its own name')
  const searched = await cdp.eval(`(async () => {
    const box = document.querySelector('.lc-settings__search')
    if (!box) return JSON.stringify({ box: false })
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(box, 'auto')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    const nav = [...document.querySelectorAll('.lc-settings__navitem')].map(b => b.innerText.replace(new RegExp('[' + String.fromCharCode(32, 9, 13, 10) + ']+', 'g'), ' ').trim())
    const headings = [...document.querySelectorAll('.lc-settings__heading')].map(h => h.innerText.trim())
    return JSON.stringify({ box: true, nav, headings })
  })()`)
  const three = JSON.parse(searched)
  say(`   ${searched}`)
  check('the list narrows to the pages that match', three.nav.length === 1, three.nav.join(' | '))
  check('and names the setting it matched', /Auto mode/.test(three.nav.join(' ')), three.nav.join(' | '))
  check('the pane follows the search', three.headings.includes('Auto mode'), three.headings.join(','))

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(new URL('../docs/chain-measure/settings-search-2026-09-17.png', import.meta.url), Buffer.from(shot.result.data, 'base64'))

  say('4. clearing the search puts every page back')
  const cleared = await cdp.eval(`(async () => {
    const box = document.querySelector('.lc-settings__search')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(box, '')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    const item = [...document.querySelectorAll('.lc-settings__navitem')].find(b => /Your workspace/.test(b.innerText))
    if (item) item.click()
    await new Promise(r => setTimeout(r, 400))
    return JSON.stringify({ nav: [...document.querySelectorAll('.lc-settings__navitem')].length })
  })()`)
  check('every page is back', JSON.parse(cleared).nav === 5, cleared)

  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = new URL('../docs/chain-measure/settings-2026-09-17.png', import.meta.url)
  await writeFile(out, Buffer.from(shot2.result.data, 'base64'))
  say(`   screenshot ${out.pathname.slice(1)}`)
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}
console.error(failures === 0 ? 'SETTINGS DRIVE PASSED' : `${String(failures)} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
