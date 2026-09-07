// The exchange strip and the autonomy budget, on the real app.
//
//   node _smoke/exchange-smoke.mjs
//
// 0.21.2 QA, rec. 6: "add user-visible autonomy budgets and an exchange
// overview: active participants, each model, hop count, estimated cost, and
// a stop control". Seeded from the records, so no runtime is spent: Wren
// asked Booty something through the workroom, Booty's run was the relay's
// first automatic reply, both finished and reported a cost. Opening Booty's
// conversation shows the strip; changing the budget in Settings changes the
// strip's denominator and the file on disk; a conversation that talked to
// nobody shows no strip at all.

import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9234

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const say = (line) => console.error(line)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const already = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`, { signal: AbortSignal.timeout(1500) })
  if (already.ok) {
    say(`  [FAIL] something is already debugging on port ${String(PORT)}`)
    process.exit(1)
  }
} catch {
  // Nothing listening, which is what we want.
}

const workspace = await mkdtemp(join(tmpdir(), 'locust-exchange-ws-'))
await writeFile(join(workspace, 'README.md'), '# exchange\n', 'utf8')
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const profile = await mkdtemp(join(tmpdir(), 'locust-exchange-'))
const LEDGER_DIR = join(profile, 'mission-ledger')
const WORKROOM_DIR = join(profile, 'workroom')
await mkdir(LEDGER_DIR, { recursive: true })
await mkdir(WORKROOM_DIR, { recursive: true })
const TEAMMATES = join(profile, 'teammates.json')
await writeFile(
  TEAMMATES,
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T00:00:00.000Z' },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: '2026-09-05T00:00:00.000Z' }
    ],
    missionOwners: { mission_wren: 'tm_wren', mission_booty: 'tm_booty', mission_alone: 'tm_wren' },
    settings: { swarm: false, relay: true }
  })
)
const T0 = '2026-09-05T02:00:00.000Z'
const T1 = '2026-09-05T02:01:00.000Z'
const T2 = '2026-09-05T02:02:00.000Z'
const T3 = '2026-09-05T02:03:00.000Z'
const PROCESS = {
  exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, inputDeliveryFailed: false,
  outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt: T0, finishedAt: T1
}

function missionFile({ missionId, runtime, model, prompt, startedBy, usd, links }) {
  const runId = `run_${missionId}`
  const metadata = {
    missionId,
    runId,
    prompt,
    runtime,
    model,
    requestedRouteId: runtime,
    resolvedRouteId: `${runtime}-account:default`,
    cliVersion: '1.0.0',
    workspaceId: WORKSPACE_ID,
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: T0,
    ...(startedBy === undefined ? {} : { startedBy })
  }
  const events = [
    { type: 'run.started', occurredAt: T0, payload: { runtimeThreadId: 'thread-1', evidence: { redacted: true } } },
    { type: 'run.completed', occurredAt: T1, payload: { usage: { total_cost_usd: usd }, process: PROCESS, evidence: { redacted: true } } }
  ]
  const lines = [JSON.stringify({ schemaVersion: 13, recordType: 'mission.created', ledgerSequence: 1, occurredAt: T0, metadata })]
  let seq = 2
  events.forEach((event, index) => {
    lines.push(JSON.stringify({
      schemaVersion: 13, recordType: 'mission.event', ledgerSequence: seq, occurredAt: event.occurredAt,
      event: { ...event, id: `${missionId}:${String(index + 1)}`, runId, missionId, sequence: index + 1, sourceAdapter: runtime }
    }))
    seq += 1
  })
  for (const link of links) {
    lines.push(JSON.stringify({ schemaVersion: 13, recordType: 'mission.peer', ledgerSequence: seq, occurredAt: link.occurredAt, link }))
    seq += 1
  }
  return `${lines.join('\n')}\n`
}

await writeFile(join(LEDGER_DIR, 'mission_wren.jsonl'), missionFile({
  missionId: 'mission_wren', runtime: 'codex', model: 'account-default', prompt: 'Ask Booty which files mention the release date', usd: 0.2,
  links: [{ direction: 'posted', messageId: 'wm_1', peerTeammateId: 'tm_booty', occurredAt: T2 }]
}), 'utf8')
await writeFile(join(LEDGER_DIR, 'mission_booty.jsonl'), missionFile({
  missionId: 'mission_booty', runtime: 'claude', model: 'claude/sonnet', prompt: 'Wren asked: which files mention the release date?', usd: 0.25,
  startedBy: { kind: 'relay', hop: 1 },
  links: [{ direction: 'received', messageId: 'wm_1', peerTeammateId: 'tm_wren', occurredAt: T3 }]
}), 'utf8')
await writeFile(join(LEDGER_DIR, 'mission_alone.jsonl'), missionFile({
  missionId: 'mission_alone', runtime: 'codex', model: 'account-default', prompt: 'Count the TODOs alone', usd: 0.05, links: []
}), 'utf8')
await writeFile(join(WORKROOM_DIR, 'workroom.jsonl'), `${JSON.stringify({
  schemaVersion: 1, recordType: 'workroom.message', sequence: 1, occurredAt: T2,
  message: { messageId: 'wm_1', from: { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_wren' }, to: { teammateId: 'tm_booty', name: 'Booty' }, text: 'Which files mention the release date?', postedAt: T2 }
})}\n`, 'utf8')

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  stdio: ['ignore', 'pipe', 'pipe']
})
const appOutput = []
child.stdout.on('data', (d) => appOutput.push(String(d)))
child.stderr.on('data', (d) => appOutput.push(String(d)))

try {
  let page
  for (let attempt = 0; attempt < 80 && page === undefined; attempt += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
  }
  if (page === undefined) throw new Error('renderer never came up')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res) => socket.addEventListener('open', res, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const w = pending.get(m.id)
    if (w) { pending.delete(m.id); w(m) }
  })
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((res) => {
        const n = ++id
        pending.set(n, res)
        socket.send(JSON.stringify({ id: n, method, params }))
      }),
      new Promise((resolve) => { const t = setTimeout(() => resolve({ error: { message: 'cdp timeout' } }), 60_000); t.unref() })
    ])
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (m.error) throw new Error(JSON.stringify(m.error))
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? 'evaluate threw')
    return m.result?.result?.value
  }
  await evaluate(`(async () => {
    for (let i = 0; i < 360; i += 1) {
      const f = document.querySelector('form.command-dock textarea')
      if (f && !/Checking local runtimes/.test(f.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)

  const OPEN = (needle) => `(async () => {
    const row = [...document.querySelectorAll('.lc-sidebar *')].filter(el => new RegExp(${JSON.stringify(needle)}, 'i').test(el.innerText ?? '')).at(-1)
    if (!row) return JSON.stringify({ found: false })
    row.click()
    await new Promise(r => setTimeout(r, 700))
    const strip = document.querySelector('.lc-exchange')
    return JSON.stringify({ found: true, strip: strip ? strip.innerText.replace(/\\s+/g, ' ').trim() : null })
  })()`

  say('1. what the host read back')
  const history = await evaluate(`window.desktop.getMissionHistory().then(r => JSON.stringify(r.ok ? { issues: r.data.issueCount, missions: r.data.missions.map(m => [m.missionId, m.phase, m.peerMessages.length, m.startedBy?.kind ?? '-']) } : r))`)
  say(`       ${history}`)
  check('all three missions read back clean', /"issues":0/.test(history) && /mission_booty/.test(history), history.slice(0, 160))

  say('2. Booty\'s conversation shows the exchange')
  const booty = JSON.parse(await evaluate(OPEN('Wren asked: which files')))
  say(`       ${JSON.stringify(booty)}`)
  check('the conversation opened', booty.found === true)
  check('the strip is there', typeof booty.strip === 'string')
  check('it names both participants', /Wren/.test(booty.strip ?? '') && /Booty/.test(booty.strip ?? ''), booty.strip)

  say('       opening it: the routes are a detail, one click away')
  const opened = await evaluate(`(async () => {
    const rest = document.querySelector('.lc-exchange__rest')
    if (!rest) return 'no collapsed strip to open'
    rest.click()
    await new Promise(r => setTimeout(r, 600))
    const band = document.querySelector('.lc-exchange')
    return band ? band.innerText.replace(/\\s+/g, ' ').trim() : 'the strip vanished when opened'
  })()`)
  say(`       ${String(opened).slice(0, 160)}`)
  check(
    'opened, it names each one\'s route',
    /Codex CLI \/ default/.test(String(opened)) && /Claude Code \/ claude\/sonnet/.test(String(opened)),
    String(opened).slice(0, 200)
  )
  check('and it still names both participants', /Wren/.test(String(opened)) && /Booty/.test(String(opened)), String(opened).slice(0, 200))
  check('it counts the automatic replies against the budget', /1 of 6 automatic replies/.test(booty.strip ?? ''), booty.strip)
  check('it adds up the cost of both runs', /\$0\.45/.test(booty.strip ?? ''), booty.strip)
  check('no stop control: nothing is running', !/Stop/.test(booty.strip ?? ''), booty.strip)

  say('3. CONTROL: a conversation that talked to nobody has no strip')
  const alone = JSON.parse(await evaluate(OPEN('Count the TODOs alone')))
  check('the lone conversation opened', alone.found === true)
  check('and shows no exchange', alone.strip === null, String(alone.strip))

  say('4. the budget is the person\'s own number')
  const settings = JSON.parse(await evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => /^Settings$/.test(b.innerText.trim()))
    button.click()
    await new Promise(r => setTimeout(r, 600))
    const group = document.querySelector('[role="radiogroup"][aria-label="Automatic replies per exchange"]')
    if (!group) return JSON.stringify({ group: false })
    const choices = [...group.querySelectorAll('button')].map(b => [b.innerText.trim(), b.getAttribute('aria-checked')])
    const two = [...group.querySelectorAll('button')].find(b => b.innerText.trim() === '2')
    two.click()
    await new Promise(r => setTimeout(r, 700))
    const lede = [...document.querySelectorAll('.lc-settings__lede')].map(p => p.innerText).find(t => /automatic repl/.test(t)) ?? ''
    return JSON.stringify({ group: true, choices, after: [...group.querySelectorAll('button')].map(b => [b.innerText.trim(), b.getAttribute('aria-checked')]), lede: lede.replace(/\\s+/g, ' ') })
  })()`))
  say(`       ${JSON.stringify(settings).slice(0, 300)}`)
  check('Settings offers the budget as fixed steps', settings.group === true && settings.choices?.length === 6, JSON.stringify(settings.choices))
  check('six is the default', settings.choices?.find((c) => c[0] === '6')?.[1] === 'true')
  check('two is now chosen', settings.after?.find((c) => c[0] === '2')?.[1] === 'true', JSON.stringify(settings.after))
  check('the copy says the number, not "six"', /after 2 automatic replies/.test(settings.lede ?? ''), settings.lede)

  await sleep(500)
  const stored = JSON.parse(await readFile(TEAMMATES, 'utf8'))
  check('the host recorded the budget', stored.settings?.relayHopCap === 2, JSON.stringify(stored.settings))

  say('5. the strip reads the new budget')
  const again = JSON.parse(await evaluate(OPEN('Wren asked: which files')))
  check('now 1 of 2', /1 of 2 automatic replies/.test(again.strip ?? ''), again.strip)
} catch (error) {
  failures += 1
  say(`  [FAIL] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1200)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}

if (failures > 0) {
  say('--- app output (tail) ---')
  say(appOutput.join('').slice(-1500))
  say(`\n${String(failures)} EXCHANGE FAILURE(S)`)
  process.exit(1)
}
say('\nexchange smoke passed')
