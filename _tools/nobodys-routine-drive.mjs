// A conversation nobody owns, saved as a routine.
//
//   node _tools/nobodys-routine-drive.mjs
//
// The last hole in the solo path. A conversation can be started with nobody
// picked -- that is half of what the product is for -- and since 0.191.0 such
// a run knows the folder and the project's memory. Saving it as a routine
// still did nothing: the menu item was there, it was not disabled, and
// pressing it opened no dialog, because the code returned early when the
// conversation had no owner.
//
// A routine is the words the PERSON typed, and those exist whether or not
// anybody was picked. The one genuinely missing fact is whose route replays
// them, so the dialog asks. This drives that from where a person stands:
// open the menu on an ownerless conversation, press Save as routine, and
// check that the dialog opens, asks who runs it, refuses to save until that
// is answered, and then really writes a routine.
//
// Spends nothing -- the conversation is seeded straight into the ledger, and
// no provider is ever launched.

import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-nobodyroutine-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-nobodyroutine-profile-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })

// The sidebar is scoped to the folder you are in, so a seeded mission has to
// carry THIS folder's id or it renders nowhere.
const WORKSPACE_ID = `ws_${createHash('sha256').update(resolve(workspace), 'utf8').digest('hex').slice(0, 32)}`
const AT = '2026-09-19T02:00:00.000Z'
const TYPED = 'Tidy the notes folder and tell me what you moved'
await writeFile(
  join(profile, 'mission-ledger', 'mission_solo.jsonl'),
  `${JSON.stringify({
    schemaVersion: 7,
    recordType: 'mission.created',
    ledgerSequence: 1,
    occurredAt: AT,
    metadata: {
      missionId: 'mission_solo',
      runId: 'run_mission_solo',
      prompt: TYPED,
      runtime: 'opencode',
      model: 'opencode/muse-spark-1.3-contributor-free',
      requestedRouteId: 'opencode',
      resolvedRouteId: 'opencode:muse-spark-1.3-contributor-free',
      cliVersion: '0.153.0',
      workspaceId: WORKSPACE_ID,
      sandbox: 'read-only',
      executionPolicyVersion: 1,
      createdAt: AT
    }
  })}\n`,
  'utf8'
)
/*
 * A teammate EXISTS but owns nothing.
 *
 * That is the whole shape of the case: `missionOwners` is empty, so the
 * conversation belongs to nobody, and there is somebody available to be
 * asked about. A profile with no teammates at all is the other branch and
 * the dialog says so in words; this one is the branch a person is actually
 * in, because they made a teammate and then started a conversation without
 * picking them.
 */
await writeFile(
  join(profile, 'teammates.json'),
  JSON.stringify({
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-19T01:00:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }),
  'utf8'
)

const drive = await startDrive({ name: 'nobodys-routine', port: 9352, workspace, profilePath: profile })

const OPEN = `(async () => {
  const flat = (el) => el.innerText.split('\\n').map((t) => t.trim()).filter(Boolean).join(' ')
  let row
  for (let i = 0; i < 25 && row === undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    // The button INSIDE the row carries the handler, not the row wrapper.
    row = document.querySelector('.lc-convrow .lc-conv') || document.querySelector('.lc-teammate__missionrow')
  }
  if (!row) return 'no conversation row in the sidebar'
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 120 }))
  await new Promise((r) => setTimeout(r, 700))
  const item = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].find((b) => /Save as routine/i.test(flat(b)))
  if (!item) return 'no Save as routine item; menu was: ' + [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].map(flat).join(' | ')
  if (item.disabled) return 'DISABLED: ' + (item.getAttribute('title') || 'no reason given')
  item.click()
  await new Promise((r) => setTimeout(r, 900))
  const dialog = document.querySelector('[role=dialog]')
  if (!dialog) return 'NO DIALOG: the menu item did nothing'
  const select = dialog.querySelector('#routine-runner')
  const save = [...dialog.querySelectorAll('button')].find((b) => /Save routine/i.test(flat(b)))
  return JSON.stringify({
    dialog: true,
    asksWhoRunsIt: /Who runs it/i.test(flat(dialog)),
    choices: select ? [...select.options].map((o) => o.text) : [],
    // Nobody chosen yet, so the button must be unavailable and the sentence
    // above it must say why. A disabled button on its own says nothing.
    saveDisabled: save ? save.disabled : null,
    says: /not assigned to anyone/i.test(flat(dialog))
  })
})()`

const ANSWER = `(async () => {
  const flat = (el) => el.innerText.split('\\n').map((t) => t.trim()).filter(Boolean).join(' ')
  const dialog = document.querySelector('[role=dialog]')
  if (!dialog) return 'the dialog closed'
  const select = dialog.querySelector('#routine-runner')
  if (!select) return 'no teammate choice on the dialog'
  const wanted = [...select.options].find((o) => /Wren/.test(o.text))
  if (!wanted) return 'Wren is not offered'
  const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setValue.call(select, wanted.value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  const save = [...dialog.querySelectorAll('button')].find((b) => /Save routine/i.test(flat(b)))
  if (!save) return 'no Save routine button'
  if (save.disabled) return 'STILL DISABLED after picking a teammate'
  save.click()
  await new Promise((r) => setTimeout(r, 1500))
  const listed = await window.desktop.listRoutines()
  return JSON.stringify({
    closed: !document.querySelector('[role=dialog]'),
    routines: listed.ok ? listed.data.routines.map((r) => ({ name: r.name, teammateId: r.teammateId, steps: r.steps.length, route: r.route.runtime })) : 'list failed'
  })
})()`

try {
  await drive.capture('the menu on a conversation nobody owns', async () => {
    await drive.ready()
    return drive.evaluate(OPEN)
  })
  await drive.capture('pick who runs it, and save', () => drive.evaluate(ANSWER))
  // The round trip, read off disk rather than off the screen that wrote it.
  await drive.capture('what is on disk afterwards', async () => {
    const stored = await readFile(join(profile, 'routines.json'), 'utf8').catch(() => '(no routines.json)')
    return stored.slice(0, 600)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Saving a conversation nobody owns as a routine.' })
}
