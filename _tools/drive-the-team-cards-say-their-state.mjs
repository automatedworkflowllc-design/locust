// Does each team card on Home say where that teammate stands (0.606)?
//
//   node _tools/drive-the-team-cards-say-their-state.mjs [--packaged <exe>] [--tag <name>]
//
// Four teammates seeded with finished conversations at known times, Home
// opened: every card carries a state beside the name, and an idle teammate's
// says when they last worked ("3h ago" on the card, "last worked 3 hours ago"
// read aloud). Then Wren is asked one word on the free
// OpenCode model (nothing spent): while the run is live her card says the
// live word -- working, thinking or replying -- in the live colour, and once
// it ends it says she last worked just now. The control (the 0.605 package)
// has no state on an idle card at all, and "working" alone on a live one.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `the-team-cards-say-their-state-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-team-state-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const at = '2026-09-10T09:00:00.000Z'
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: { ...FREE_ROUTE, mode: 'ask' } },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', role: 'Data & Reporting', createdAt: at }
]
const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString()
// Sable has no conversation at all: her card must say so rather than nothing.
const WORK = [
  ['tm_wren', 'Move the release notes under the installer', hoursAgo(3)],
  ['tm_atlas', 'Summarise the three placement rulings', hoursAgo(30)],
  ['tm_juno', 'Check every empty state says what to do next', hoursAgo(26 * 24)],
  ['tm_wren', 'Fix the short-name folder check', hoursAgo(50)]
]
const SCHEMA = 15
const line = (value) => JSON.stringify(value) + '\n'
const ledgerFile = (missionId, prompt, createdAt) => {
  const runId = `run_${missionId.slice(2)}`
  // On the free model, so that continuing one of these conversations stays free (a drive's window may use no other).
  const metadata = { missionId, runId, prompt, runtime: 'opencode', model: FREE_ROUTE.model, requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: '1.18.27', workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt }
  const header = { schemaVersion: SCHEMA, recordType: 'mission.created', ledgerSequence: 1, occurredAt: createdAt, metadata }
  const events = [
    { type: 'run.started', payload: {} },
    { type: 'message.delta', payload: { itemId: 'answer_1', operation: 'append', text: 'Done.', final: true } },
    { type: 'run.completed', payload: { status: 'completed' } }
  ].map((event, index) => ({ schemaVersion: SCHEMA, recordType: 'mission.event', ledgerSequence: index + 2, occurredAt: createdAt, event: { id: `event_${missionId}_${String(index)}`, runId, missionId, sequence: index + 1, occurredAt: createdAt, sourceAdapter: 'opencode', ...event } }))
  return line(header) + events.map(line).join('')
}
const files = {}
const missionOwners = {}
WORK.forEach(([owner, prompt, createdAt], index) => {
  const missionId = `m_state${String(index).padStart(2, '0')}`
  files[`mission-ledger/${missionId}.jsonl`] = ledgerFile(missionId, prompt, createdAt)
  missionOwners[missionId] = owner
})

const drive = await startDrive({
  name: `the-team-cards-say-their-state-${tag}`, port: 9802, workspace, files, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** Each card: the name, the state word and its tone class, and the spoken label. */
const cards = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-hometeam__card')].map((card) => {
  const state = card.querySelector('.lc-hometeam__state')
  return { name: card.querySelector('.lc-hometeam__name')?.firstChild?.textContent?.trim() ?? '', word: state ? state.innerText.trim() : null, tone: state ? [...state.classList].find((c) => c.startsWith('is-')) ?? null : null, aria: card.getAttribute('aria-label') ?? '' }
}))`)))
const byName = (list, name) => list.find((card) => card.name === name)
const LIVE = /^(working|thinking|replying|subagent working)$/
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  const before = await cards()
  await drive.capture('Home: the team cards, every teammate idle', async () => JSON.stringify(before))
  say(`  cards: ${JSON.stringify(before)}`)
  check('four cards', before.length === 4, String(before.length))
  check('every card says a state beside the name', before.every((card) => card.word !== null && card.word.length > 0), JSON.stringify(before.map((card) => card.word)))
  check('Wren, idle, says 3h ago on the card and "last worked 3 hours ago" aloud', byName(before, 'Wren')?.word === '3h ago' && byName(before, 'Wren')?.tone === 'is-muted' && (byName(before, 'Wren')?.aria ?? '').includes('last worked 3 hours ago'), JSON.stringify(byName(before, 'Wren')))
  check('Atlas says yesterday in hours or a day', /^(1d|\d+h) ago$/.test(byName(before, 'Atlas')?.word ?? ''), JSON.stringify(byName(before, 'Atlas')))
  check('Juno says weeks', byName(before, 'Juno')?.word === '3w ago', JSON.stringify(byName(before, 'Juno')))
  check('Sable, with no conversation, says "no work yet"', byName(before, 'Sable')?.word === 'no work yet', JSON.stringify(byName(before, 'Sable')))
  check('every card reads its state aloud, the idle ones in full words', before.every((card) => /, (last worked .+ ago|no work yet|[a-z ]+)(,|$)/.test(card.aria)), JSON.stringify(before.map((card) => card.aria)))

  // Wren, asked one word on the free model: her card goes live, then rests.
  const sent = JSON.parse(String(await drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))
    if (!card) return JSON.stringify({ sent: false, why: 'no Wren card' })
    card.click()
    await new Promise((r) => setTimeout(r, 800))
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return JSON.stringify({ sent: false, why: 'no composer' })
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with the single word DONE and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return JSON.stringify({ sent: true }) }
    }
    return JSON.stringify({ sent: false, why: 'Send never enabled' })
  })()`)))
  check('Wren was asked one word', sent.sent === true, JSON.stringify(sent))
  await sleep(2500)
  const afterSend = String(await drive.evaluate(`JSON.stringify({ header: document.querySelector('.lc-workroom__mission')?.innerText ?? '', thread: (document.querySelector('.lc-thread')?.innerText ?? '').replace(/s+/g, ' ').slice(-400), running: document.querySelector('button[aria-label^="Stop the running"]') !== null, rows: document.querySelectorAll('button.lc-conv').length })`))
  await drive.capture('right after Send, before going Home', async () => afterSend)
  say(`  after Send: ${afterSend}`)
  // Back to Home while she works: the brand lockup is Home.
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  let live
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    const now = await cards()
    const wren = byName(now, 'Wren')
    if (wren !== undefined && LIVE.test(wren.word ?? '')) { live = wren; break }
  }
  await drive.capture('Home while Wren works', async () => JSON.stringify(live ?? await cards()))
  check('while she works, her card says the live word in the live colour', live !== undefined && live.tone === 'is-live', JSON.stringify(live))
  let rested
  for (let i = 0; i < 240; i += 1) {
    await sleep(1000)
    const now = await cards()
    const wren = byName(now, 'Wren')
    if (wren !== undefined && !LIVE.test(wren.word ?? '')) { rested = wren; break }
  }
  await drive.capture('Home after the run', async () => JSON.stringify(rested ?? await cards()))
  check('once the run ends, her card says "just now", muted, and "last worked just now" aloud', rested?.word === 'just now' && rested?.tone === 'is-muted' && (rested?.aria ?? '').includes('last worked just now'), JSON.stringify(rested))
  say(failures === 0 ? '\nTHE TEAM CARDS SAY THEIR STATE PASSED' : `\nTHE TEAM CARDS SAY THEIR STATE: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever the last build wrote to out/'}. Four teammates seeded with conversations 3 h, 30 h, 26 d and never ago; Wren asked one word on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
  process.exitCode = failures === 0 ? 0 : 1
}
