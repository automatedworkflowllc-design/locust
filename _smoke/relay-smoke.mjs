// Relay smoke: two teammates hold an exchange without a person in the loop.
//
//   node _smoke/relay-smoke.mjs
//
// Seeds Wren and Booty with teammate replies switched ON, asks Wren (on
// Cursor / composer-2.5, the cheap route) to send Booty one question through
// the share form, and then watches what the host does on its own:
//
//   1. Booty's run starts by itself, owned by Booty, briefed with the
//      question -- the sidebar shows Booty working with nobody having typed.
//   2. Booty answers with a share block; Wren's next turn starts by itself
//      as a FOLLOW-UP of Wren's first mission, so the answer lands in the
//      thread that asked.
//   3. It ends on its own when a reply has nothing more to say, and the
//      ledger holds the missions with the links that say why.
//
// The answer is a passphrase Wren asks Booty to repeat, so "the reply
// arrived" is checked on a word that could only have come from Booty's run.
//
// And each teammate stays the model a person made them. Booty is first run
// by a person on Claude Code / sonnet; Wren on Cursor / composer-2.5. When
// Booty replies on their own it must be on Claude, and Wren's next turn on
// Cursor -- people will pit one model against another on purpose, and that
// only means anything if each side stays itself.
// Needs signed-in cursor-agent and claude. Costs four short runs.

// FIRST: points tmpdir() outside AppData, where `~/.cursorignore` makes
// every Cursor run blind to the workspace. See _tools/scratch-root.mjs.
import '../_tools/scratch-root.mjs'

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9233
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
const CURSOR_DIR = 'C:\\Users\\<home>\\AppData\\Local\\cursor-agent'
const CODE = 'PEBBLE-' + String(Math.floor(Math.random() * 9000) + 1000)
const PROMPT = `Send your teammate Booty one message using the share block form, asking them to reply with exactly the word ${CODE} and nothing else. Do not read or edit any files, and do nothing else.`

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
    const settleTimers = new Set()
    const clearTimers = () => { for (const t of settleTimers) clearInterval(t) }
    return Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve: (m) => { clearTimers(); resolve(m) } })),
      new Promise((resolve) => {
        // One timer, cleared when the answer wins and unref()'d: the sleep loop
        // this replaced kept the process alive for up to 600s after the
        // last line (six smokes 'not exiting cleanly', QA on 0.21.2).
        let ticks = 0
        const tick = setInterval(() => {
          ticks += 1
          if (child.exitCode !== null) { clearInterval(tick); resolve({ error: { message: `app exited ${child.exitCode} mid-step` } }) }
          else if (ticks >= 600) { clearInterval(tick); resolve({ error: { message: 'cdp timeout' } }) }
        }, 1000)
        tick.unref()
        settleTimers.add(tick)
        })
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

const profile = await mkdtemp(join(tmpdir(), 'locust-relay-smoke-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-relay-work-'))
await mkdir(profile, { recursive: true })
await writeFile(join(workspace, 'README.md'), 'scratch workspace\n', 'utf8')
const createdAt = new Date().toISOString()
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', createdAt }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true }
  })
)
const LEDGER_DIR = join(profile, 'mission-ledger')

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${CURSOR_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  say('1. the app starts with two teammates and replies switched on')
  let page
  for (let attempt = 0; attempt < 60 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) break
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {
      // not up yet
    }
  }
  check('renderer target available', page !== undefined, child.exitCode === null ? undefined : `app exited ${child.exitCode}`)
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
  const discovered = await cdp.eval(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      if (control && /cursor|codex|claude/i.test(control.innerText)) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  })()`)
  check('discovery finished', discovered === true)

  say("2a. a person runs Booty once on Claude Code / Sonnet: that route becomes Booty's")
  const bootyFirst = await cdp.eval(`(async () => {
    // The roster renders a beat after discovery reports done; run 4 on
    // 2026-09-04 asked for the button in that beat and got nothing.
    let booty
    for (let attempt = 0; attempt < 40 && !booty; attempt += 1) {
      booty = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Booty')
      if (!booty) await new Promise(r => setTimeout(r, 250))
    }
    if (!booty) return JSON.stringify({ booty: false })
    booty.click()
    await new Promise(r => setTimeout(r, 400))
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    control.click()
    await new Promise(r => setTimeout(r, 400))
    let target
    for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      const input = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(input, 'sonnet')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        const label = row ? row.innerText.trim().toLowerCase() : ''
        if (row && !row.disabled && /claude/i.test(group) && label.startsWith('sonnet')) { target = row; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return JSON.stringify({ booty: true, picked: false })
    target.click()
    await new Promise(r => setTimeout(r, 400))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with the single word READY. Do not read any files and do not run anything.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const send = document.querySelector('form.command-dock .send-button')
      if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') { send.click(); break }
    }
    let sawRunning = false
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      if (stop) sawRunning = true
      if (sawRunning && !stop && /completed|failed|cancelled/i.test((document.querySelector('.lc-workroom__header') || document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText)) {
        return JSON.stringify({ booty: true, picked: true, done: true, header: (document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText, error: (document.querySelector('.lc-card.is-red') || { innerText: '' }).innerText })
      }
    }
    return JSON.stringify({ booty: true, picked: true, done: false })
  })()`)
  const bootyRun = JSON.parse(bootyFirst)
  check("Booty's first run on Claude Code / Sonnet completed", bootyRun.done === true && !bootyRun.error, bootyFirst.slice(0, 300))
  const bootyOwnRoute = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).teammates.find((t) => t.teammateId === 'tm_booty')?.route
  check("the host recorded Claude Code / sonnet as Booty's own route", bootyOwnRoute?.runtime === 'claude' && bootyOwnRoute?.model === 'sonnet', JSON.stringify(bootyOwnRoute))

  say('2. message Wren on Cursor / Composer 2.5, Accept edits')
  const setup = await cdp.eval(`(async () => {
    const wren = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren')
    if (!wren) return JSON.stringify({ wren: false })
    wren.click()
    await new Promise(r => setTimeout(r, 400))
    // Each runtime's model list arrives after discovery, so the row may not
    // exist on the first look. Keep the picker open and keep searching.
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    control.click()
    await new Promise(r => setTimeout(r, 400))
    let target
    for (let attempt = 0; attempt < 90 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      const input = picker.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(input, 'composer 2.5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      let group = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) group = header.innerText
        const row = node.querySelector('.lc-picker__row')
        const label = row ? row.innerText.trim().toLowerCase() : ''
        if (row && !row.disabled && /cursor/i.test(group) && label.startsWith('composer 2.5')) { target = row; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return JSON.stringify({ wren: true, picked: false, why: 'no composer row' })
    target.click()
    await new Promise(r => setTimeout(r, 400))
    const modeControl = [...document.querySelectorAll('.lc-control')].find(b => /ask|accept|approve/i.test(b.innerText))
    if (modeControl) {
      modeControl.click()
      await new Promise(r => setTimeout(r, 400))
      const item = [...document.querySelectorAll('[role="menuitem"], button')].find(b => /accept edits/i.test(b.innerText) && !b.disabled)
      if (item) item.click()
      await new Promise(r => setTimeout(r, 400))
    }
    return JSON.stringify({
      wren: true,
      picked: true,
      header: (document.querySelector('.lc-workroom__mission') || document.querySelector('.lc-workroom') || { innerText: '' }).innerText.slice(0, 80),
      controls: [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/[^a-z0-9 ./-]+/gi, ' ').trim())
    })
  })()`)
  const chosen = JSON.parse(setup)
  check('Wren was selected', chosen.wren === true, setup)
  check('Composer 2.5 was picked under Cursor Agent', chosen.picked === true, setup)
  say(`       controls: ${JSON.stringify(chosen.controls)}`)

  say('3. Wren sends Booty the question')
  const submitted = await cdp.eval(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const send = document.querySelector('form.command-dock .send-button')
      if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') { send.click(); return 'clicked' }
    }
    return 'send stayed disabled: ' + (field.placeholder || '')
  })()`)
  check('the mission was submitted', submitted === 'clicked', submitted)

  // Ledger files appear as missions start. Three is the whole exchange.
  const ledgers = async () => (await readdir(LEDGER_DIR).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const waitForLedgers = async (count, seconds) => {
    for (let i = 0; i < seconds; i += 1) {
      if ((await ledgers()).length >= count) return true
      await sleep(1000)
    }
    return false
  }

  say("4. Booty's run starts on its own")
  check('a third mission appeared without anyone typing', await waitForLedgers(3, 300), `ledgers: ${(await ledgers()).length}`)
  const bootyWorking = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      const name = [...document.querySelectorAll('.lc-row__name')].find(n => n.innerText.trim().startsWith('Booty'))
      const button = name ? name.closest('button') : null
      const wrap = button ? button.parentElement : null
      const meta = button ? (button.querySelector('.lc-row__meta') || { innerText: '' }).innerText : ''
      const missions = wrap ? wrap.querySelectorAll('.lc-teammate__mission').length : 0
      if (missions > 0 || /working|replying|running/i.test(meta)) {
        return 'Booty: ' + meta.trim() + ' · missions listed: ' + String(missions)
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return ''
  })()`)
  check("the sidebar shows Booty's run under Booty", bootyWorking.length > 0, bootyWorking)

  say("5. Booty's answer starts Wren's next turn, and it lands in Wren's thread")
  check('a fourth mission appeared: the reply back', await waitForLedgers(4, 300), `ledgers: ${(await ledgers()).length}`)
  const thread = await cdp.eval(`(async () => {
    for (let i = 0; i < 300; i += 1) {
      const row = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
      const conversation = row ? row.querySelector('.lc-teammate__mission') : null
      if (conversation && conversation.getAttribute('class').indexOf('is-active') === -1) conversation.click()
      await new Promise(r => setTimeout(r, 1000))
      const stop = document.querySelector('button[aria-label^="Stop the running"]')
      for (const toggle of document.querySelectorAll('.lc-peer:not(.is-open) .lc-peer__toggle')) toggle.click()
      const fromBooty = [...document.querySelectorAll('.lc-peer__message')].find(m => {
        // Drawn per message only when BOTH sides spoke; a one-sided card
        // names its sender once, on the pill above.
        const card = m.closest('.lc-peer') ?? m
        const author = (m.querySelector('.lc-peer__author')
          || card.querySelector('.lc-peer__name')
          || { innerText: '' }).innerText.trim()
        const body = (m.querySelector('.lc-peer__bubble') || { innerText: '' }).innerText
        return author === 'Booty' && body.includes(${JSON.stringify(CODE)})
      })
      // The OTHER half: what Wren actually sent Booty. It is written on an
      // earlier turn than the reply, and the thread used to draw only the
      // newest turn's exchange -- so this was invisible and the thread read
      // as though Booty had answered the person (Colin, 2026-09-04).
      const fromWren = [...document.querySelectorAll('.lc-peer__message')].find(m => {
        // Drawn per message only when BOTH sides spoke; a one-sided card
        // names its sender once, on the pill above.
        const card = m.closest('.lc-peer') ?? m
        const author = (m.querySelector('.lc-peer__author')
          || card.querySelector('.lc-peer__name')
          || { innerText: '' }).innerText.trim()
        return author === 'Wren'
      })
      if (!stop && fromBooty) {
        return JSON.stringify({
          found: true,
          outgoingShown: fromWren !== undefined,
          // Double-escaped on purpose: this whole function is inside a JS
          // template literal before it reaches the page, and a lone \s there
          // collapses to a bare s -- which quietly turned this into /s+/g and
          // deleted every letter s from the reported text.
          outgoing: fromWren ? fromWren.innerText.replace(/\\s+/g, ' ').slice(0, 200) : null,
          excerpt: fromBooty.innerText.slice(0, 300)
        })
      }
    }
    return JSON.stringify({ found: false, excerpt: (document.querySelector('.lc-thread') || { innerText: '' }).innerText.slice(-400) })
  })()`)
  const seen = JSON.parse(thread)
  say(`       thread tail: ${(seen.excerpt ?? '').replace(/\s+/g, ' ').slice(-300)}`)
  check("Wren's thread carries Booty's answer with the passphrase", seen.found === true)
  say(`       what Wren sent: ${seen.outgoing ?? '(nothing drawn)'}`)
  check("Wren's thread also shows the message Wren SENT, not only the reply", seen.outgoingShown === true)

  say('6. it ends on its own')
  // The exchange ends when a reply has nothing more to say. Wren's follow-up
  // may add a word back, which is allowed; what is not allowed is an
  // exchange that keeps going, so: quiet for 40s, and well under the cap.
  let names = await ledgers()
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000)
    const now = await ledgers()
    if (now.length !== names.length) { names = now; i = 0 }
  }
  // What matters is that it stopped BECAUSE a reply had nothing more to say,
  // not because the cap fired. A fixed count of four is too tight: on
  // 2026-09-04 Booty (Claude/sonnet) declined to echo an arbitrary token
  // without knowing why, Wren explained, and the exchange finished correctly
  // in one more round trip. A model that asks before complying is behaving
  // well, and a smoke test that calls that a failure teaches the wrong thing.
  // One seeded run precedes the exchange, so the relayed runs are the rest.
  const MAX_RELAY_HOPS = 6
  const relayed = names.length - 1
  check(
    'the exchange ended on its own rather than running into the hop cap',
    relayed >= 3 && relayed < MAX_RELAY_HOPS,
    `ledgers: ${names.length} (${relayed} relayed, cap ${MAX_RELAY_HOPS})`
  )

  // Nothing on screen may be NAMED by the briefing the host wrote to a
  // runtime. That sentence was appearing as a mission title beside the
  // person's own conversations (Colin, 2026-09-04).
  const titles = await cdp.eval(`(() => {
    const seen = []
    for (const node of document.querySelectorAll('.lc-teammate__mission, .lc-rostercard__mission')) {
      seen.push((node.innerText || '').replace(/[ \\t\\r\\n]+/g, ' ').trim())
    }
    return JSON.stringify(seen)
  })()`)
  const shown = JSON.parse(titles)
  say(`       titles on screen: ${shown.map((title) => JSON.stringify(title.slice(0, 70))).join(', ')}`)
  const briefing = shown.filter((title) => /locust-share|sent you a message|replied to you/i.test(title))
  check('no mission on screen is named by the host briefing', briefing.length === 0, briefing.join(' | ').slice(0, 200))

  const headers = await Promise.all(names.map(async (name) => JSON.parse((await readFile(join(LEDGER_DIR, name), 'utf8')).split('\n')[0]).metadata))
  headers.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  // Exactly two runs in this scenario were started by a person -- Booty's
  // seeding run and Wren's -- and they are the two oldest. Everything after
  // them is the host answering on a teammate's behalf. Written as a partition
  // rather than by index, because indexing the wrong header is how the first
  // version of this check failed against correct data.
  const starters = headers.map((header) => header.startedBy)
  check(
    'exactly the two runs a person started carry no starter',
    starters.filter((starter) => starter === undefined).length === 2
      && starters[0] === undefined
      && starters[1] === undefined,
    JSON.stringify(starters.map((starter) => starter ?? 'person'))
  )
  check(
    'every run the host started is recorded as a relay, hop counting up from 1',
    starters.slice(2).every((starter, index) => starter?.kind === 'relay' && starter.hop === index + 1),
    JSON.stringify(starters.map((starter) => starter ?? 'person'))
  )
  // headers[0] is Booty's first, person-started run.
  const [, first, second, third] = headers
  const owners = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).missionOwners ?? {}
  check("the second mission is Booty's", owners[second?.missionId] === 'tm_booty', JSON.stringify(owners))
  check("the second mission's prompt is the host's brief naming Wren", (second?.prompt ?? '').includes('Wren (Code & Migrations) sent you a message'), (second?.prompt ?? '').slice(0, 120))
  check("the third mission is Wren's and follows up the first", owners[third?.missionId] === 'tm_wren' && third?.continuesFrom?.missionId === first?.missionId && third?.continuesFrom?.reason === 'follow-up', JSON.stringify({ owner: owners[third?.missionId], continuesFrom: third?.continuesFrom }))
  check("Booty's reply ran on Booty's own route, Claude Code / sonnet", second?.runtime === 'claude' && second?.model === 'sonnet', JSON.stringify([second?.runtime, second?.model]))
  check("Wren's turns ran on Wren's route, Cursor / composer-2.5", first?.runtime === 'cursor' && first?.model === 'composer-2.5' && third?.runtime === 'cursor' && third?.model === 'composer-2.5', JSON.stringify(headers.map((h) => [h.runtime, h.model])))
  check("a relayed run did not overwrite Booty's own route", (JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).teammates.find((t) => t.teammateId === 'tm_booty')?.route ?? {}).runtime === 'claude')
} finally {
  child.kill()
  await sleep(500)
  // `--keep` leaves the profile so a run where the reply never came can be
  // read afterwards: Booty's ledger says whether the run completed, whether
  // it posted a share, and what it actually wrote. Without it the evidence is
  // deleted the moment the smoke reports the failure.
  if (process.argv.includes('--keep')) {
    say(`profile kept at ${profile}`)
  } else {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

console.error(failures === 0 ? '\nRELAY SMOKE PASSED' : `\n${failures} RELAY SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
