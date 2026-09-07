// Can a routine be saved without knowing to right-click?
//
//   node _tools/drive-routine-affordance.mjs
//
// `Save as routine` exists and works -- schedule-smoke proves it end to end --
// but its only gesture was a right-click on a conversation row, and nothing on
// screen said a row had a menu. A first outside tester read the Automations
// screen, went to the teammate card it pointed at, found Edit / Remove, and
// filed the whole feature as missing (2026-09-07).
//
// This uses the visible control only: no contextmenu event anywhere.
//
// Spends nothing -- the conversation is seeded straight into the ledger.

import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-affordance-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-affordance-profile-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })

// The sidebar is scoped to the folder you are in, so a seeded mission has to
// carry THIS folder's id or it renders nowhere -- which is exactly what the
// first attempt at this drive got wrong.
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const AT = '2026-09-05T02:00:00.000Z'
await writeFile(
  join(profile, 'mission-ledger', 'mission_taught.jsonl'),
  `${JSON.stringify({
    schemaVersion: 7,
    recordType: 'mission.created',
    ledgerSequence: 1,
    occurredAt: AT,
    metadata: {
      missionId: 'mission_taught',
      runId: 'run_mission_taught',
      prompt: 'Summarise what changed today',
      runtime: 'codex',
      model: 'account-default',
      requestedRouteId: 'codex',
      resolvedRouteId: 'codex-account:default',
      cliVersion: '0.153.0',
      workspaceId: WORKSPACE_ID,
      sandbox: 'read-only',
      executionPolicyVersion: 1,
      createdAt: AT
    }
  })}\n`,
  'utf8'
)
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T01:00:00.000Z' }
    ],
    missionOwners: { mission_taught: 'tm_wren' },
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }),
  'utf8'
)

const drive = await startDrive({ name: 'routine-affordance', port: 9350, workspace, profilePath: profile })

const FIND = `(async () => {
  // No regex: a \s in a template literal that then crosses the CDP bridge
  // has been eaten twice tonight, turning every 's' in the report into a
  // space ('Copy mi ion id').
  const flat = (el) => el.innerText.split('\\n').map((t) => t.trim()).filter(Boolean).join(' ')
  let row
  for (let i = 0; i < 20 && row === undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    row = document.querySelector('.lc-teammate__missionrow')
  }
  if (!row) return 'no conversation row in the sidebar'
  const menu = row.querySelector('.lc-teammate__missionmenu')
  if (!menu) return 'row has no visible menu control'
  // Nothing here dispatches a contextmenu: the point is that a person who
  // does not know to right-click can still get there.
  menu.click()
  await new Promise((r) => setTimeout(r, 700))
  const items = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].map(flat)
  return 'menu items: ' + (items.length ? items.join(' · ') : 'none')
    + ' || Save as routine: ' + (items.some((t) => /Save as routine/i.test(t)) ? 'PRESENT' : 'ABSENT')
})()`

const SAVE = `(async () => {
  // No regex: a \s in a template literal that then crosses the CDP bridge
  // has been eaten twice tonight, turning every 's' in the report into a
  // space ('Copy mi ion id').
  const flat = (el) => el.innerText.split('\\n').map((t) => t.trim()).filter(Boolean).join(' ')
  const item = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find((b) => /Save as routine/i.test(flat(b)))
  if (!item) return 'no Save as routine item'
  if (item.disabled) return 'disabled: ' + (item.getAttribute('title') ?? 'no reason given')
  item.click()
  await new Promise((r) => setTimeout(r, 900))
  const dialog = document.querySelector('[role=dialog]')
  return dialog ? 'dialog opened: ' + flat(dialog).slice(0, 120) : 'no dialog opened'
})()`

try {
  await drive.capture('the visible control, pressed', async () => {
    await drive.ready()
    return drive.evaluate(FIND)
  })

  await drive.capture('and it saves a routine', () => drive.evaluate(SAVE))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Saving a routine without knowing to right-click.' })
}
