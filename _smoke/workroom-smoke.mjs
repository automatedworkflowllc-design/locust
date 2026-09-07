// Workroom smoke: launch the built app with two seeded teammates, have the
// first run a real Codex mission that shares a finding, then have the second
// run a mission that is briefed with it -- and assert on the SCREEN, the
// channel file, and both ledgers.
//
//   node _smoke/workroom-smoke.mjs
//
// Exits non-zero on any failed assertion. Always kills the app on the way out.
//
// Why this is worth running beyond the unit tests: the whole feature is a
// claim that one teammate's work can reach another's, routed and labelled,
// through a durable channel. That claim spans the roster, the prompt the
// runtime is actually sent, a real model deciding to emit a share block, the
// channel file, two ledgers, and a card that renders the exchange as claims.
// Every one of those seams is somewhere a fake would have agreed with a
// broken build.
//
// The controls are the point: before anything is shared there must be NO peer
// card and NO channel file, and the person's own bubble must never carry the
// machine-written briefing.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9225
const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'

const ATLAS_PROMPT =
  'Read package.json at the top of this workspace and find the single script that runs the full check (build, typecheck and tests together). Report the exact command. Then tell Wren what it is.'
const WREN_PROMPT =
  'A teammate may have left you a message about which command runs this repository\u2019s full check. Repeat the exact command back and say who told you. Do not read any files and do not run anything.'

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
      // Fail fast if the app itself is gone: a dead renderer never answers,
      // and waiting on it would report a crash as a slow step.
      new Promise((resolve) => {
        // One timer, cleared when the answer wins and unref()'d: the sleep loop
        // this replaced kept the process alive for up to 400s after the
        // last line (six smokes 'not exiting cleanly', QA on 0.21.2).
        let ticks = 0
        const tick = setInterval(() => {
          ticks += 1
          if (child.exitCode !== null) { clearInterval(tick); resolve({ error: { message: `app exited ${child.exitCode} mid-step` } }) }
          else if (ticks >= 400) { clearInterval(tick); resolve({ error: { message: 'cdp timeout' } }) }
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
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw')
    }
    return result?.result?.value
  }
}

// Seed the roster before launch. Creating teammates through the dialog was
// verified when the roster landed; this smoke is about what they can say to
// each other, so the roster is a fixture rather than a step.
const profile = await mkdtemp(join(tmpdir(), 'locust-workroom-smoke-'))
await mkdir(profile, { recursive: true })
const createdAt = new Date().toISOString()
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt },
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt }
    ],
    missionOwners: {},
    // The relay has its own smoke; here a PERSON delivers the message, so Wren must be free when messaged.
    settings: { swarm: false, relay: false }
  }, null, 2)
)
const WORKROOM_FILE = join(profile, 'workroom', 'workroom.jsonl')
const LEDGER_DIR = join(profile, 'mission-ledger')

const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: APP_DIR,
  env: { ...process.env, PATH: `${CODEX_BIN_DIR};${NPM_DIR};${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

async function readJsonl(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line))
  } catch {
    return undefined
  }
}

async function ledgers() {
  let names = []
  try {
    names = (await readdir(LEDGER_DIR)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    const records = await readJsonl(join(LEDGER_DIR, name))
    if (records) out.push({ missionId: name.slice(0, -'.jsonl'.length), records })
  }
  return out
}

const typeInto = (prompt) => `(() => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(prompt)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  return field.placeholder
})()`

// Type, then wait for the send control to be enabled before clicking it.
// Discovery can still be running when the smoke reaches the composer, and a
// click on a disabled control is not a submission.
const submit = (prompt) => `(async () => {
  ${typeInto(prompt)}
  for (let i = 0; i < 120; i += 1) {
    await new Promise(r => setTimeout(r, 250))
    const send = document.querySelector('form.command-dock .send-button')
    if (send && !send.disabled && send.getAttribute('aria-label') === 'Start mission') {
      send.click()
      return 'clicked'
    }
  }
  return 'send stayed disabled'
})()`

const discoveryDone = `(async () => {
  for (let i = 0; i < 240; i += 1) {
    const field = document.querySelector('form.command-dock textarea')
    if (field && !/Checking local runtimes/.test(field.placeholder)) return field.placeholder
    await new Promise(r => setTimeout(r, 250))
  }
  return 'still checking'
})()`

// A mission is finished when the stop control is gone, the host's receipt has
// come back (the marker), and the provider said something. Waiting on the
// stop control alone would pass between submit and the first receipt.
const waitForCompletion = `(async () => {
  let sawRunning = false
  for (let i = 0; i < 360; i += 1) {
    await new Promise(r => setTimeout(r, 1000))
    const stop = document.querySelector('button[aria-label^="Stop the running"]')
    const marker = /completed|failed|cancelled/i.test((document.querySelector('.lc-workroom__header') || document.querySelector('.lc-workroom__mission') || { innerText: '' }).innerText)
    if (stop) sawRunning = true
    const spoke = document.querySelectorAll('.lc-agentline').length > 0
    if (sawRunning && !stop && marker && spoke) return JSON.stringify({ done: true, waitedMs: i * 1000 })
  }
  return JSON.stringify({ done: false, sawRunning })
})()`

const selectTeammate = (name) => `(async () => {
  const row = [...document.querySelectorAll('.lc-row--button')].find(b => b.title === 'Message ${name}')
  if (!row) return 'no row'
  row.click()
  await new Promise(r => setTimeout(r, 300))
  const field = document.querySelector('form.command-dock textarea')
  return field ? field.placeholder : 'no composer'
})()`

try {
  say('1. the app starts with two teammates and a usable Codex')
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

  const ready = await cdp.eval(`(async () => {
    for (let i = 0; i < 80; i += 1) {
      const rows = document.querySelectorAll('.lc-row--button[title^="Message "]').length
      if (document.querySelector('form.command-dock textarea') && rows >= 2) return rows
      await new Promise(r => setTimeout(r, 250))
    }
    return document.querySelectorAll('.lc-row--button[title^="Message "]').length
  })()`)
  check('both seeded teammates are in the sidebar', ready === 2, `rows: ${ready}`)

  say('2. CONTROL: text typed while discovery is still running does not start on its own')
  // The first run of this smoke reported a disabled send control and then a
  // mission that ran anyway. No renderer path submits without a click, a key
  // or a starter button, so this pins it: type a sentinel while discovery is
  // loading, let discovery finish, and assert nothing started.
  const typedEarly = await cdp.eval(typeInto('SENTINEL: do nothing, this must never run'))
  const wasLoading = /Checking local runtimes/.test(typedEarly)
  const placeholderAfter = await cdp.eval(discoveryDone)
  await sleep(8000)
  const autoStarted = await cdp.eval(`document.querySelector('button[aria-label^="Stop the running"]') !== null`)
  const ledgersEarly = await ledgers()
  say(`       typed while ${wasLoading ? 'discovery was loading' : 'discovery had already finished'}; placeholder now: ${placeholderAfter}`)
  check('CONTROL: nothing starts without a click', autoStarted === false && ledgersEarly.length === 0,
    `stop button: ${autoStarted}, ledgers: ${ledgersEarly.length}`)
  await cdp.eval(typeInto(''))

  say('3. address Atlas')
  const atlasPlaceholder = await cdp.eval(selectTeammate('Atlas'))
  check('the composer says it is messaging Atlas', /Message Atlas/.test(atlasPlaceholder), atlasPlaceholder)

  say('3b. CONTROLS: nothing has been shared yet')
  const peerBefore = await cdp.eval(`document.querySelectorAll('.lc-peer').length`)
  check('CONTROL: no peer card before any exchange', peerBefore === 0)
  check('CONTROL: no channel file before any exchange', (await readJsonl(WORKROOM_FILE)) === undefined)

  say('4. Atlas runs a mission that ends by sharing with Wren')
  const submitted1 = await cdp.eval(submit(ATLAS_PROMPT))
  check('Atlas\u2019s mission was submitted', submitted1 === 'clicked', submitted1)
  const done1 = JSON.parse(await cdp.eval(waitForCompletion))
  check('Atlas\u2019s mission completed', done1.done === true, JSON.stringify(done1))

  // The share is posted after the terminal events are durable, so give the
  // host a moment past "completed" before calling the card missing.
  const card1 = await cdp.eval(`(async () => {
    for (let i = 0; i < 40; i += 1) {
      const card = document.querySelector('.lc-peer')
      if (card) return JSON.stringify({ found: true, text: card.innerText })
      await new Promise(r => setTimeout(r, 500))
    }
    return JSON.stringify({ found: false, text: (document.querySelector('.lc-thread__column') || { innerText: '' }).innerText.slice(-600) })
  })()`)
  const cardState1 = JSON.parse(card1)
  cardState1.text = cardState1.text.replace(/\s+/g, ' ').trim()
  check('a peer card appears on Atlas\u2019s thread', cardState1.found === true, cardState1.text)
  check('it counts one message with Wren, and says which way it went', /1 message (to|from|with)\s*Wren/i.test(cardState1.text), cardState1.text)

  const opened1 = await cdp.eval(`(async () => {
    const toggle = document.querySelector('.lc-peer__toggle')
    if (!toggle) return JSON.stringify({ opened: false })
    // A short exchange starts OPEN since 2026-09-04 (peerExchangeStartsOpen); clicking would close it.
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    await new Promise(r => setTimeout(r, 200))
    const card = document.querySelector('.lc-peer')
    return JSON.stringify({
      opened: true,
      expanded: toggle.getAttribute('aria-expanded'),
      text: card.innerText,
      bubble: (card.querySelector('.lc-peer__bubble') || { innerText: '' }).innerText,
      author: (card.querySelector('.lc-peer__author') || { innerText: '' }).innerText,
      // Drawn INSTEAD of a per-message author when the exchange is one-sided.
      peerName: (card.querySelector('.lc-peer__name') || { innerText: '' }).innerText,
      agentText: [...document.querySelectorAll('.lc-agentline')].map(n => n.innerText).join('\\n')
    })
  })()`)
  const open1 = JSON.parse(opened1)
  const openText = (open1.text ?? '').replace(/\s+/g, ' ')
  check('the card opens', open1.opened === true && open1.expanded === 'true')
  // The UNTRUSTED tag and the "treated as claims" footer were REMOVED on
  // Colin's word (2026-09-06): "teammates are AI, no one else adds
  // disclaimers with their models in chat like that, why clutter?" What
  // carries the honesty instead is that you can always tell who said a
  // thing, and there are two shapes of that:
  //
  //   one-sided  the pill names the PEER and the label names the direction,
  //              so "1 message to Wren" on Atlas's thread is unambiguous
  //   two-sided  every message carries its own .lc-peer__author
  //
  // This card is Atlas's thread talking to Wren, so it is the first shape.
  const attributed =
    (open1.author ?? '').trim().length > 0
    || (/^Wren$/.test((open1.peerName ?? '').trim()) && /1 message (to|from)\s*Wren/i.test(openText))
  check(
    'you can tell who said it: the peer is named and the direction is stated',
    attributed,
    `author: ${JSON.stringify(open1.author)} peer pill: ${JSON.stringify(open1.peerName)} label: ${openText.slice(0, 60)}`
  )
  check('the share block is not also inside Atlas\u2019s own bubble', !/locust-share/.test(open1.agentText ?? ''),
    (open1.agentText ?? '').slice(-200))

  say('5. the channel and Atlas\u2019s ledger hold the same message')
  const channel1 = await readJsonl(WORKROOM_FILE)
  const messages1 = (channel1 ?? []).filter((r) => r.recordType === 'workroom.message').map((r) => r.message)
  check('the channel file holds the message', messages1.length >= 1, JSON.stringify(channel1 ?? null).slice(0, 300))
  const shared = messages1[0]
  if (shared) {
    check('it is from Atlas to Wren', shared.from.teammateId === 'tm_atlas' && shared.to.teammateId === 'tm_wren', JSON.stringify(shared))
    check('the screen shows the same text the file holds', open1.bubble.trim() === shared.text.trim(),
      `screen: ${open1.bubble.slice(0, 80)} | file: ${shared.text.slice(0, 80)}`)
    say(`       shared: ${shared.text.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  const ledgers1 = await ledgers()
  check('exactly one mission ledger exists', ledgers1.length === 1, `ledgers: ${ledgers1.length}`)
  const atlasLedger = ledgers1[0]
  const postedLinks = (atlasLedger?.records ?? []).filter((r) => r.recordType === 'mission.peer' && r.link.direction === 'posted')
  check('Atlas\u2019s ledger links the posted message', shared !== undefined && postedLinks.some((r) => r.link.messageId === shared.messageId),
    JSON.stringify(postedLinks))
  // Read from the source of truth rather than repeating the number here: this
  // assertion sat at v5 while the app correctly wrote v9, so it failed for
  // three schema bumps in a row and said nothing true about any of them
  // (found by Codex's QA pass, 2026-08-31).
  const schemaSource = await readFile(new URL('../packages/mission-store/src/index.ts', import.meta.url), 'utf8')
  const expectedSchema = Number((schemaSource.match(/MISSION_LEDGER_SCHEMA_VERSION = (\d+)/) ?? [])[1])
  check(
    `the ledger header is schema v${String(expectedSchema)}, the version the store defines`,
    Number.isInteger(expectedSchema) && atlasLedger?.records[0]?.schemaVersion === expectedSchema,
    `header ${String(atlasLedger?.records[0]?.schemaVersion)}, store ${String(expectedSchema)}`
  )
  const roster1 = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8'))
  check('the mission is recorded as Atlas\u2019s', atlasLedger !== undefined && roster1.missionOwners[atlasLedger.missionId] === 'tm_atlas',
    JSON.stringify(roster1.missionOwners))
  check('Atlas\u2019s ledger records the person\u2019s words, not the briefing',
    atlasLedger?.records[0]?.metadata?.prompt === ATLAS_PROMPT)

  say('6. address Wren, whose next mission is briefed with the claim')
  const wrenPlaceholder = await cdp.eval(selectTeammate('Wren'))
  check('the composer says it is messaging Wren', /Message Wren/.test(wrenPlaceholder), wrenPlaceholder)
  const submitted2 = await cdp.eval(submit(WREN_PROMPT))
  check('Wren\u2019s mission was submitted', submitted2 === 'clicked', submitted2)

  const early = await cdp.eval(`(async () => {
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      // NOT a completion check: the claim is that the exchange appears as
      // soon as the run STARTS, so waiting for a terminal state tests the
      // opposite. (My own blanket edit made that mistake -- the marker this
      // replaced meant "the thread is rendering", not "the run ended".)
      const card = document.querySelector('.lc-peer')
      const stillRunning = document.querySelector('button[aria-label^="Stop the running"]') !== null
      if (card) {
        const column = document.querySelector('.lc-thread__column')
        const kids = [...column.children]
        const firstAgent = kids.findIndex(k => k.matches('.lc-agentline, .lc-card'))
        return JSON.stringify({
          found: true,
          text: card.innerText,
          cardIndex: kids.indexOf(card),
          firstAgent,
          stillRunning,
          bubble: (document.querySelector('.lc-bubble') || { innerText: '' }).innerText
        })
      }
    }
    return JSON.stringify({ found: false })
  })()`)
  const earlyState = JSON.parse(early)
  check('Wren\u2019s thread shows the exchange as soon as the run starts', earlyState.found === true, JSON.stringify(earlyState).slice(0, 200))
  // The point of "as soon as": it must not wait for the run to be over.
  check('and it was there while the run was still going', earlyState.stillRunning === true, `stillRunning: ${earlyState.stillRunning}`)
  if (earlyState.found) {
    const t = earlyState.text.replace(/\s+/g, ' ')
    check('it counts one message with Atlas, and says which way it went', /1 message (to|from|with)\s*Atlas/i.test(t), t)
    check('the received exchange sits above the work', earlyState.firstAgent === -1 || earlyState.cardIndex < earlyState.firstAgent,
      `card ${earlyState.cardIndex}, first agent item ${earlyState.firstAgent}`)
    check('CONTROL: the person\u2019s bubble is their words alone, not the briefing',
      earlyState.bubble.trim() === WREN_PROMPT && !/CLAIMS/.test(earlyState.bubble), earlyState.bubble.slice(0, 120))
  }

  const done2 = JSON.parse(await cdp.eval(waitForCompletion))
  check('Wren\u2019s mission completed', done2.done === true, JSON.stringify(done2))
  const reply = await cdp.eval(`[...document.querySelectorAll('.lc-agentline')].map(n => n.innerText).join('\\n')`)
  const replyText = reply.replace(/\s+/g, ' ')
  say(`       Wren: ${replyText.slice(0, 240)}`)
  check('Wren names Atlas as the source', /atlas/i.test(replyText), replyText.slice(0, 200))
  // Any pnpm command Atlas's share named counts: a share like "check is
  // pnpm build && pnpm typecheck" is repeated as "pnpm check" or "pnpm build"
  // depending on the model, and either is the shared fact passed on.
  const commands = shared ? [...shared.text.matchAll(/pnpm[ \w:-]*/gi)].map((m) => m[0].trim().toLowerCase()).filter((c) => c.length > 'pnpm '.length) : []
  const command = commands.join(' | ')
  if (commands.length > 0) {
    check(`Wren repeats a shared command (${command})`, commands.some((c) => replyText.toLowerCase().includes(c)) || /pnpm\s+check/i.test(replyText), replyText.slice(0, 200))
  }

  say('7. the channel records the delivery and Wren\u2019s ledger links it')
  const channel2 = await readJsonl(WORKROOM_FILE)
  const deliveries = (channel2 ?? []).filter((r) => r.recordType === 'workroom.delivery').map((r) => r.delivery)
  const ledgers2 = await ledgers()
  const wrenLedger = ledgers2.find((entry) => entry.records[0]?.metadata?.prompt === WREN_PROMPT)
  check('two mission ledgers exist', ledgers2.length === 2, `ledgers: ${ledgers2.length}`)
  check('the channel marks the message delivered to Wren\u2019s mission',
    shared !== undefined && wrenLedger !== undefined && deliveries.some((d) => d.messageId === shared.messageId && d.missionId === wrenLedger.missionId),
    JSON.stringify(deliveries))
  const receivedLinks = (wrenLedger?.records ?? []).filter((r) => r.recordType === 'mission.peer' && r.link.direction === 'received')
  check('Wren\u2019s ledger links the received message', shared !== undefined && receivedLinks.some((r) => r.link.messageId === shared.messageId),
    JSON.stringify(receivedLinks))
  const roster2 = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8'))
  check('the mission is recorded as Wren\u2019s', wrenLedger !== undefined && roster2.missionOwners[wrenLedger.missionId] === 'tm_wren')
  check('the ledger sequence is contiguous through the peer records',
    (wrenLedger?.records ?? []).every((r, i) => r.ledgerSequence === i + 1))

  say('8. Atlas\u2019s finished mission is still in the sidebar, and reopens')
  // What Colin saw watching the first run: Wren's thread replaced Atlas's and
  // Atlas's row was gone. History was only read at startup, and nothing could
  // be reopened. Both must hold now.
  const reopened = await cdp.eval(`(async () => {
    let row
    for (let i = 0; i < 40; i += 1) {
      row = [...document.querySelectorAll('.lc-teammate__mission, .lc-sidebar .lc-row')]
        .find(b => b.tagName === 'BUTTON' && b.innerText.includes('Read package.json'))
      if (row) break
      await new Promise(r => setTimeout(r, 250))
    }
    if (!row) return JSON.stringify({ found: false })
    const disabled = row.disabled
    row.click()
    await new Promise(r => setTimeout(r, 400))
    const bubble = (document.querySelector('.lc-bubble') || { innerText: '' }).innerText
    const peer = (document.querySelector('.lc-peer') || { innerText: '' }).innerText
    return JSON.stringify({ found: true, disabled, bubble, peer })
  })()`)
  const reopenState = JSON.parse(reopened)
  check('Atlas\u2019s mission row is still listed after Wren\u2019s ran', reopenState.found === true)
  if (reopenState.found) {
    const peerText = String(reopenState.peer).replace(/\s+/g, ' ')
    check('the row is clickable once nothing is running', reopenState.disabled === false)
    check('clicking it shows Atlas\u2019s own prompt', reopenState.bubble.trim() === ATLAS_PROMPT, reopenState.bubble.slice(0, 80))
    check('the reopened thread carries the exchange with Wren', /1 message (to|from|with)\s*Wren/i.test(peerText), peerText)
  }
} finally {
  child.kill()
  await sleep(500)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-3000))
  say(`\n${failures} FAILED`)
  process.exit(1)
}
say('\nworkroom smoke passed')
