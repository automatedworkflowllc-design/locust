// Are the sidebar's places rows with counts, with Board in the bottom bar (0.605)?
//
//   node _tools/drive-the-places-are-rows.mjs [--packaged <exe>] [--tag <name>]
//
// A realistic profile, seeded straight into the ledger (four teammates,
// fourteen conversations, two rooms, no routines) -- the state Colin's own
// sidebar is in, not the empty one. Nothing is spent; no runtime starts.
//
// Colin, 2026-10-04, on the places as a two-by-two grid: counts, and Board
// down in the bottom bar beside Settings. 0.605 drew them as three rows with
// a number at the far right; Colin, 2026-10-04: "too much dead space". So
// (0.609): three places side by side in ONE row, as 0.488 drew them, every
// word whole and no counts (beside the words they cut every word; on the
// icon's corner the 14 ran into the C); the footer reads Settings · Board ·
// "N agents ready"; the compact rail keeps the places stacked as icons and
// Board above the gear. The control (the 0.608 package) has the three rows.

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('beta-fixes-2026-09-24'), `the-places-are-rows-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-places-rows-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const at = '2026-09-10T09:00:00.000Z'
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE },
  { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', role: 'Data & Reporting', createdAt: at, route: FREE_ROUTE }
]
const WORK = [
  ['tm_wren', 'Move the release notes under the installer', '2026-10-04T14:20:00.000Z'],
  ['tm_juno', 'Read every empty state for a missing verb', '2026-10-04T11:45:00.000Z'],
  ['tm_atlas', 'Summarise the three placement rulings', '2026-10-03T20:05:00.000Z'],
  ['tm_wren', 'Stagger discovery so a slow probe does not block the rest', '2026-10-03T17:30:00.000Z'],
  [null, 'quick one: what does LOCUST.md get used for', '2026-10-03T15:10:00.000Z'],
  ['tm_sable', 'Chart the release cadence since 0.500', '2026-10-02T22:00:00.000Z'],
  ['tm_juno', 'Check every empty state says what to do next', '2026-10-02T18:25:00.000Z'],
  ['tm_atlas', 'Compare how Cursor and Claude Code report spend', '2026-10-02T09:15:00.000Z'],
  ['tm_wren', 'Fix the short-name folder check', '2026-10-01T16:00:00.000Z'],
  ['tm_sable', 'Count the ledgers over 2 MB', '2026-10-01T12:30:00.000Z'],
  ['tm_juno', 'Proofread the changelog back to 0.580', '2026-09-30T19:00:00.000Z'],
  ['tm_atlas', 'Brief: what the other apps do on a cold start', '2026-09-30T10:00:00.000Z'],
  ['tm_wren', 'Make the gate retry a timeout once', '2026-09-29T15:45:00.000Z'],
  [null, 'is the mirror script idempotent', '2026-09-29T09:05:00.000Z']
]
const SCHEMA = 15
const line = (value) => JSON.stringify(value) + '\n'
const ledgerFile = (missionId, prompt, createdAt) => {
  const runId = `run_${missionId.slice(2)}`
  const metadata = { missionId, runId, prompt, runtime: 'opencode', model: 'account-default', requestedRouteId: 'opencode', resolvedRouteId: 'opencode-account:default', cliVersion: '1.18.27', workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt }
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
  const missionId = `m_rows${String(index).padStart(2, '0')}`
  files[`mission-ledger/${missionId}.jsonl`] = ledgerFile(missionId, prompt, createdAt)
  if (owner !== null) missionOwners[missionId] = owner
})
files['rooms.json'] = { schemaVersion: 1, rooms: [
  { roomId: 'room_ship', name: 'Ship review', teammateIds: ['tm_wren', 'tm_juno'], posts: [], createdAt: at },
  { roomId: 'room_beta', name: 'Beta readiness', teammateIds: ['tm_wren', 'tm_atlas', 'tm_sable'], posts: [], createdAt: at }
] }

const drive = await startDrive({
  name: `the-places-are-rows-${tag}`, port: 9801, workspace, files, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** The places and the footer as drawn: label, count, geometry. */
const read = async () => JSON.parse(String(await drive.evaluate(`(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }
  const places = [...document.querySelectorAll('.lc-sidebar__places:not(.lc-sidebar__places--pinned) button')].map((b) => {
    const count = b.querySelector('.lc-sidebar__count')
    const word = b.querySelector('span:not(.lc-sidebar__count)')
    return { label: (word?.innerText ?? '').trim(), cut: word ? word.scrollWidth > word.clientWidth + 1 : false, count: count ? count.innerText.trim() : null, ...box(b), top: Math.round(b.getBoundingClientRect().top), countRight: count ? Math.round(count.getBoundingClientRect().right) : null, right: Math.round(b.getBoundingClientRect().right) }
  })
  const footer = [...document.querySelectorAll('.lc-sidebar__footer button')].map((b) => ({ label: (b.querySelector('span')?.innerText ?? '').trim(), title: b.getAttribute('title') ?? '', ...box(b) }))
  const status = document.querySelector('.lc-sidebar__footer .lc-connected')
  const sidebar = document.querySelector('.lc-sidebar')
  return JSON.stringify({ places, footer, status: status ? { text: status.innerText.replace(/\\s+/g, ' ').trim(), title: status.getAttribute('title') ?? '', ...box(status), overflow: status.scrollWidth - status.clientWidth } : null, sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null, compact: document.querySelector('.lc-shell.is-compact') !== null })
})()`)))
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  const wide = await read()
  await drive.capture('the sidebar at 1440 wide', async () => JSON.stringify(wide))
  say(`  at 1440: ${JSON.stringify(wide)}`)
  check('three places, in this order: Conversations, Rooms, Routines', JSON.stringify(wide.places.map((p) => p.label)) === JSON.stringify(['Conversations', 'Rooms', 'Routines']), JSON.stringify(wide.places.map((p) => p.label)))
  check('the three places share one row (same top), each narrower than half the sidebar', wide.places.length === 3 && wide.places.every((p) => p.top === wide.places[0].top && p.w < wide.sidebarWidth / 2 && p.w > 40), JSON.stringify(wide.places.map((p) => [p.top, p.w])) + ` of ${String(wide.sidebarWidth)}`)
  // No counts (0.609): beside the words they cut every word; on the icon's corner the 14 ran into the C.
  check('the places carry no counts', wide.places.every((p) => p.count === null), JSON.stringify(wide.places.map((p) => p.count)))
  // The first dev frame of 0.609 had every word cut ("Conversa… Ro… Routi…") once the counts sat beside them.
  check('no word is cut', wide.places.every((p) => p.cut === false), JSON.stringify(wide.places.map((p) => [p.label, p.cut])))
  check('Board is in the bottom bar, after Settings', JSON.stringify(wide.footer.map((b) => b.label)) === JSON.stringify(['Settings', 'Board']), JSON.stringify(wide.footer))
  check('the footer status says how many agents are ready, whole', wide.status !== null && /^\d+ agents? ready$/.test(wide.status.text) && wide.status.overflow <= 0, JSON.stringify(wide.status))
  check("the status's title keeps the full sentence", wide.status !== null && /^\d+ AI agents? ready$/.test(wide.status.title), JSON.stringify(wide.status?.title))
  await drive.resize(1100, 720)
  await sleep(1500)
  const compact = await read()
  await drive.capture('the rail at 1100 wide', async () => JSON.stringify(compact))
  say(`  at 1100: ${JSON.stringify(compact)}`)
  check('the compact rail keeps three places as icons', compact.compact === true && compact.places.length === 3, JSON.stringify(compact.places))
  check('and Board stands with Settings in the rail\'s foot', JSON.stringify(compact.footer.map((b) => b.title.split(/ [—(]/)[0].trim())) === JSON.stringify(['Settings', 'Board']), JSON.stringify(compact.footer))
  say(failures === 0 ? '\nTHE PLACES ARE ROWS PASSED' : `\nTHE PLACES ARE ROWS: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever the last build wrote to out/'}. Four teammates, fourteen conversations, two rooms seeded; the sidebar read at 1440 and 1100 wide.`, extra: `Checks failed: ${String(failures)}` })
  process.exitCode = failures === 0 ? 0 : 1
}
