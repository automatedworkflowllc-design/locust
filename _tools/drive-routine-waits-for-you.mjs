// A scheduled routine in Approve each says it waits for you (0.591, PRD U4).
//
//   node _tools/drive-routine-waits-for-you.mjs [--packaged <exe>] [--tag <name>]
//
// Two routines on the same teammate, both scheduled daily at 07:00: one on a
// route in Approve each, one in Ask. The Routines screen must say, on the
// Approve each row only, that fired while nobody is here it waits for you on
// its first card. Sends nothing; no model runs.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-routine-waits-ws-')
const WREN = { teammateId: 'tm_aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-08-10T09:00:00.000Z' }
const routine = (routineId, name, mode) => ({
  routineId, teammateId: WREN.teammateId, name, steps: ['Summarize what the team did yesterday into DIGEST.md.'],
  route: { runtime: 'codex', model: 'account-default', mode }, learnedFrom: [], createdAt: '2026-10-01T09:00:00.000Z', runs: 1, lastRunAt: '2026-10-03T07:00:30.000Z',
  schedule: { kind: 'daily', at: '07:00' }
})
const drive = await startDrive({
  name: `routine-waits-for-you-${tag}`, port: 9857, workspace, sendsNothing: true,
  outPath: join(recordRoot('routine-waits-for-you-2026-10-04'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [WREN], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } },
  files: { 'routines.json': { schemaVersion: 1, routines: [routine('rt_aaaaaaaaaaaaaaaaaaaaaaa1', 'Morning digest', 'approve-each'), routine('rt_aaaaaaaaaaaaaaaaaaaaaaa2', 'Quiet digest', 'ask')] } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
try {
  await drive.ready()
  await drive.resize(1440, 900)
  const rows = JSON.parse(String(await drive.capture('Routines: the Approve each row says it waits', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => b.innerText.trim() === 'Routines')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const rows = [...document.querySelectorAll('.lc-routinerow')]
    return JSON.stringify(rows.map((row) => ({
      name: row.querySelector('.lc-routinerow__name')?.innerText.trim() ?? row.innerText.split('\\n')[0],
      waits: row.querySelector('.lc-routinerow__waits')?.innerText.trim() ?? null
    })))
  })()`))))
  check('two routines are listed', rows.length === 2, JSON.stringify(rows))
  const digest = rows.find((row) => /Morning digest/.test(row.name))
  const quiet = rows.find((row) => /Quiet digest/.test(row.name))
  check('the Approve each row says it waits for you on its first card', digest?.waits === 'Runs in Approve each: fired while you are away, it waits for you on its first card. Ask or Accept edits runs through.', JSON.stringify(digest))
  check('the Ask row says nothing of the kind (control)', quiet !== undefined && quiet.waits === null, JSON.stringify(quiet))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Two scheduled routines, one in Approve each, one in Ask; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
