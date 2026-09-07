// Does the sidebar's mission count agree with the Missions screen?
//
//   node _tools/drive-mission-counts.mjs
//
// A first outside tester, 2026-09-07: "Sidebar mission count (3) vs Missions
// view (5)." Two numbers for one word, on one screen, is the kind of thing
// that makes a person stop trusting every other number in the app.
//
// The sidebar counts `shownUnowned` -- missions NOT nested under a teammate,
// because owned ones are drawn under their owner instead. So the question is
// whether each number is right about its own list, and whether a person can
// tell they are counting different things. The section used to be called
// "Other missions", which said so; it was renamed to plain "Missions" on
// 2026-09-06, and the word that explained the count went with it.
//
// Five missions are seeded: three belonging to nobody, two owned by Wren.
// Spends nothing -- the ledger is written directly, no runs.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-counts-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-counts-profile-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })

const WORKSPACE_ID = 'ws_counts'
const seedMission = async (id, prompt, at) => {
  const metadata = {
    missionId: id,
    runId: `run_${id}`,
    prompt,
    runtime: 'codex',
    model: 'account-default',
    requestedRouteId: 'codex',
    resolvedRouteId: 'codex-account:default',
    cliVersion: '0.153.0',
    workspaceId: WORKSPACE_ID,
    sandbox: 'read-only',
    executionPolicyVersion: 1,
    createdAt: at
  }
  await writeFile(
    join(profile, 'mission-ledger', `${id}.jsonl`),
    `${JSON.stringify({ schemaVersion: 7, recordType: 'mission.created', ledgerSequence: 1, occurredAt: at, metadata })}\n`,
    'utf8'
  )
}

const NOBODY = ['mission_free_a', 'mission_free_b', 'mission_free_c']
const WRENS = ['mission_wren_a', 'mission_wren_b']
let minute = 0
for (const id of [...NOBODY, ...WRENS]) {
  minute += 1
  await seedMission(id, `Seeded mission ${id}`, `2026-09-05T02:${String(minute).padStart(2, '0')}:00.000Z`)
}

await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T01:00:00.000Z' }
    ],
    // Two of the five belong to Wren, so the sidebar nests those under her
    // and its own section lists the other three.
    missionOwners: { mission_wren_a: 'tm_wren', mission_wren_b: 'tm_wren' },
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }),
  'utf8'
)

const drive = await startDrive({ name: 'mission-counts', port: 9347, workspace, profilePath: profile })

const COUNTS = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const sections = [...document.querySelectorAll('.lc-section, .lc-sidebar__section')]
  const missions = sections.find((s) => /MISSIONS/i.test(flat(s).slice(0, 40)))
  const header = missions ? flat(missions).slice(0, 60) : 'no Missions section'
  const rows = document.querySelectorAll('.lc-sidebar .lc-row--button[title^="Open"], .lc-missionrow').length
  return 'sidebar section header: ' + header
})()`

const SCREEN = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const tab = [...document.querySelectorAll('button')].find((b) => flat(b) === 'Missions')
  if (!tab) return 'no Missions tab'
  tab.click()
  await new Promise((r) => setTimeout(r, 1200))
  const rows = [...document.querySelectorAll('.lc-missionrow, .lc-screen .lc-row')].map(flat)
  const head = document.querySelector('.lc-screen__header, .lc-screen h1, .lc-screen h2')
  return 'screen header: ' + (head ? flat(head).slice(0, 80) : 'none')
    + ' || rows on the screen: ' + rows.length
})()`

try {
  await drive.capture('the sidebar, with 5 missions of which 2 are Wren’s', async () => {
    await drive.ready()
    return drive.evaluate(COUNTS)
  })

  await drive.capture('the Missions screen, counting the same five', () => drive.evaluate(SCREEN))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Five seeded missions, two of them owned. Whether the sidebar and the Missions screen agree.'
  })
}
