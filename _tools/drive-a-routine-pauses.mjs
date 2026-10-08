// Pause a routine, and resume it (0.705, from Paperclip's routine management).
//
//   node _tools/drive-a-routine-pauses.mjs [--packaged <exe>] [--tag <name>]
//
// Two routines: "Morning digest" on a schedule, "By hand" with none. On the
// Routines screen: only the scheduled one offers Pause; pressed, its chip says
// paused and the button becomes Resume; after a RESTART it is still paused (the
// routine file and the screen both); Resume brings the next time back and the
// file records when. Sends nothing.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const workspace = await scratchRepository('locust-drive-pause-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-pause-profile-'))
const outPath = join(recordRoot('a-routine-pauses-2026-10-08'), tag)
const now = new Date().toISOString()
const ROUTE = { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'ask' }
const ROUTINES = [
  { routineId: 'rt_digest', name: 'Morning digest', teammateId: 'tm_wren', route: ROUTE, steps: ['Say good morning.'], learnedFrom: [], createdAt: now, lastRunAt: now, runs: 1, schedule: { kind: 'every', hours: 24 } },
  { routineId: 'rt_hand', name: 'By hand', teammateId: 'tm_wren', route: ROUTE, steps: ['Say hello.'], learnedFrom: [], createdAt: now, runs: 0 }
]
const options = (extra) => ({ name: `a-routine-pauses-${tag}`, port: 9904, workspace, profilePath: profile, sendsNothing: true, outPath,
  ...(packaged === undefined ? {} : { packaged }), ...extra })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const ROWS = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return JSON.stringify([...document.querySelectorAll('.lc-routinerow:not(.lc-routineadd)')].map((row) => ({
    name: row.querySelector('.lc-routinerow__name')?.firstChild?.textContent?.trim() ?? '',
    chip: row.querySelector('.lc-routinerow__sched')?.innerText.trim() ?? '',
    pause: [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? '').find((l) => /^(Pause|Resume) /.test(l)) ?? null,
    pressed: [...row.querySelectorAll('button')].find((b) => /^(Pause|Resume) /.test(b.getAttribute('aria-label') ?? ''))?.getAttribute('aria-pressed') ?? null
  })))
})()`
const press = (label) => `(async () => {
  document.querySelector('button[aria-label="${label}"]')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return 1
})()`
const saved = async () => Object.fromEntries(JSON.parse(await readFile(join(profile, 'routines.json'), 'utf8')).routines.map((r) => [r.routineId, r]))

let drive = await startDrive(options({
  keep: true,
  seed: { schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: ROUTE }],
    missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } },
  files: { 'routines.json': { schemaVersion: 1, routines: ROUTINES } }
}))
try {
  await drive.ready()
  await drive.resize(1215, 800)
  const before = JSON.parse(await drive.capture('Routines: one scheduled, one by hand', () => drive.evaluate(ROWS)))
  const digest = before.find((r) => r.name === 'Morning digest')
  const hand = before.find((r) => r.name === 'By hand')
  check('only the scheduled routine offers Pause', digest?.pause === 'Pause Morning digest' && digest.pressed === 'false' && hand?.pause === null, JSON.stringify(before))
  check('the scheduled one says its next time', /next/.test(digest?.chip ?? ''), digest?.chip)
  await drive.evaluate(press('Pause Morning digest'))
  const paused = JSON.parse(await drive.capture('Morning digest paused', () => drive.evaluate(ROWS))).find((r) => r.name === 'Morning digest')
  check('paused: the chip says so and the button is Resume', /· paused$/.test(paused?.chip ?? '') && paused?.pause === 'Resume Morning digest' && paused.pressed === 'true', JSON.stringify(paused))
  check('the routine file says paused', (await saved()).rt_digest?.paused === true)
  const header = await drive.evaluate(`document.querySelector('.lc-screen__meta')?.innerText ?? ''`)
  check('the header counts it as paused, not on a schedule', /none on a schedule · 1 paused/.test(header), header)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Pause on the Routines screen. Nothing sent.` })
}

try {
  drive = await startDrive(options({ stepFrom: 100 }))
  await drive.ready()
  await drive.resize(1215, 800)
  const after = JSON.parse(await drive.capture('after a restart', () => drive.evaluate(ROWS))).find((r) => r.name === 'Morning digest')
  check('after a restart it is still paused', /· paused$/.test(after?.chip ?? '') && after?.pause === 'Resume Morning digest', JSON.stringify(after))
  await drive.evaluate(press('Resume Morning digest'))
  const resumed = JSON.parse(await drive.capture('Morning digest resumed', () => drive.evaluate(ROWS))).find((r) => r.name === 'Morning digest')
  check('resumed: the next time is back and the button is Pause again', /next/.test(resumed?.chip ?? '') && !/paused/.test(resumed?.chip ?? '') && resumed?.pause === 'Pause Morning digest', JSON.stringify(resumed))
  const file = (await saved()).rt_digest
  check('the routine file has no pause and records when it was resumed', file?.paused === undefined && typeof file?.resumedAt === 'string' && Date.now() - Date.parse(file.resumedAt) < 120_000, JSON.stringify({ paused: file?.paused, resumedAt: file?.resumedAt }))
  const errors = drive.record.flatMap((step) => step.errors)
  check('no renderer errors were captured', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`drive failed after the restart: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The same profile after a restart: still paused, then resumed.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
