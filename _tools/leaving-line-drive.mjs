// The leaving line, from where the person stands.
//
//   node _tools/leaving-line-drive.mjs
//
// Seeds a profile with one finished conversation (the 2026-09-14 acceptance
// fixture) and a groups file recording that the conversation LEFT a group
// called Trading -- a group that no longer exists -- after its only turn.
// Opens the conversation and reads the thread: the line "Trading's
// instructions no longer apply from here" must be drawn below the turn, and
// a screenshot is written beside the chain measures. No provider run.

import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9475
const FIXTURE = 'C:/Users/<home>/.codex/worktrees/e6a8/locust-astra/docs/acceptance2-20260914/ledgers/mission_4ac0d5fd-b688-4f04-8222-624a155225dd.jsonl'
const WORKSPACE = 'C:/Users/<home>/Documents/locust-acceptance2-20260914-scratch/beta2-SHmDtV'
const MISSION_ID = 'mission_4ac0d5fd-b688-4f04-8222-624a155225dd'

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

const profile = await mkdtemp(join(tmpdir(), 'locust-leaving-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
await copyFile(FIXTURE, join(profile, 'mission-ledger', `${MISSION_ID}.jsonl`))
await writeFile(
  join(profile, 'groups.json'),
  JSON.stringify({
    schemaVersion: 1,
    groups: [],
    members: {},
    left: {
      [MISSION_ID]: [
        { groupId: 'grp_trading', name: 'Trading', instructions: 'Analysis only. Never place a trade.', at: '2026-09-14T02:00:00.000Z', until: '2026-09-14T03:05:00.000Z' }
      ]
    }
  })
)
await writeFile(join(profile, 'teammates.json'), JSON.stringify({ schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, autoMode: false } }))

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: WORKSPACE,
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

  say('1. open the conversation')
  const opened = await cdp.eval(`(async () => {
    const all = [...document.querySelectorAll('button')].find(b => /^All missions/.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''))
    if (all) { all.click(); await new Promise(r => setTimeout(r, 600)) }
    let row
    for (let attempt = 0; attempt < 40 && !row; attempt += 1) {
      row = [...document.querySelectorAll('button')].find(b => /Two independent tasks/.test(b.innerText || '') || /Two independent tasks/.test(b.getAttribute('title') || ''))
      if (!row) await new Promise(r => setTimeout(r, 250))
    }
    if (!row) return JSON.stringify({ opened: false, buttons: [...document.querySelectorAll('button')].map(x => (x.innerText || x.getAttribute('title') || '').replace(/[ \\t\\r\\n]+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 40) })
    row.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const line = document.querySelector('.lc-thread__groupnote--left')
      if (line) {
        const thread = document.querySelector('.lc-thread')
        const nodes = thread ? [...thread.querySelectorAll('.lc-bubble, .lc-thread__groupnote--left, .lc-agent-message, .lc-thread__note')] : []
        return JSON.stringify({ opened: true, line: line.innerText, order: nodes.map(n => n.className.split(' ')[0] + ': ' + n.innerText.replace(/[ \\t\\r\\n]+/g, ' ').slice(0, 50)) })
      }
    }
    return JSON.stringify({ opened: true, line: null, thread: (document.querySelector('.lc-thread') || { innerText: '' }).innerText.slice(-600) })
  })()`)
  say(`   ${opened.slice(0, 1500)}`)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const out = new URL('../docs/chain-measure/leaving-line-2026-09-17.png', import.meta.url)
  await writeFile(out, Buffer.from(shot.result.data, 'base64'))
  say(`   screenshot ${out.pathname.slice(1)}`)
  if (!JSON.parse(opened).line) process.exitCode = 1
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}
