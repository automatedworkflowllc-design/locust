// Does a scheduled routine run only in the folder it was made in (M15)?
//
//   node _tools/drive-routine-stays-home.mjs [--packaged <exe>] [--tag <name>]
//
// Two routines are due on launch: one made in this folder, one made in
// another. Routines are kept for the whole app, not per folder, and the
// schedule started a due one in whichever folder was open -- a routine made
// to fix tests in project A replayed its steps, in its write mode, in
// project B, with nobody there. Only this folder's may run here.
//
// On the free OpenCode model, so the run that does start spends nothing.

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `routine-stays-home-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-routinehome-ws-')
const here = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const there = `ws_${'a'.repeat(32)}`
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-routinehome-profile-'))
const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { ...FREE_ROUTE, mode: 'accept-edits' }
// Due 30 s after seeding, so WHILE the app is open. Five hours back, both were due before launch, and since
// the no-catch-up rule (10/03, a-routine-due-while-closed-is-missed) a time that passed while Locust was
// closed is recorded as missed, not started -- the drive then saw nothing run and blamed the routine.
const due = new Date(Date.now() - 3_600_000 + 30_000).toISOString()
await writeFile(join(profilePath, 'routines.json'), JSON.stringify({
  schemaVersion: 1,
  routines: [
    { routineId: 'rt_here', name: 'Made here', teammateId: 'tm_wren', route: ROUTE, steps: ['Reply with the word HERE-ROUTINE and nothing else. Do not edit any files.'], learnedFrom: ['mission_1'], createdAt: due, runs: 0, schedule: { kind: 'every', hours: 1 }, workspaceId: here },
    { routineId: 'rt_there', name: 'Made elsewhere', teammateId: 'tm_booty', route: ROUTE, steps: ['Reply with the word THERE-ROUTINE and nothing else. Do not edit any files.'], learnedFrom: ['mission_2'], createdAt: due, runs: 0, schedule: { kind: 'every', hours: 1 }, workspaceId: there }
  ]
}), 'utf8')

const drive = await startDrive({
  name: 'routine-stays-home',
  port: 9587,
  workspace,
  profilePath,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const started = async () => {
  const names = (await readdir(join(profilePath, 'mission-ledger')).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  const prompts = []
  for (const name of names) {
    const first = (await readFile(join(profilePath, 'mission-ledger', name), 'utf8')).split(String.fromCharCode(10))[0]
    try { prompts.push(String(JSON.parse(first).metadata?.prompt ?? '')) } catch { /* not a ledger file */ }
  }
  return prompts
}
try {
  await drive.capture('launch: two routines due, one made here and one elsewhere', () => drive.ready())
  await drive.resize(1215, 800)
  // The first routine tick is 15 s after launch; give it a second one too.
  let prompts = []
  for (let i = 0; i < 90; i += 1) {
    await sleep(1000)
    prompts = await started()
    if (i >= 80 || prompts.some((p) => /HERE-ROUTINE/.test(p))) break
  }
  await sleep(5000)
  prompts = await started()
  await drive.capture('what ran', () => drive.evaluate(`document.querySelector('.lc-sidebar')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? ''`))
  say(`  missions started: ${JSON.stringify(prompts.map((p) => p.slice(0, 40)))}`)
  check('the routine made here ran', prompts.some((p) => /HERE-ROUTINE/.test(p)))
  check('the routine made elsewhere did not', !prompts.some((p) => /THERE-ROUTINE/.test(p)))
  say(failures === 0 ? '\nROUTINE STAYS HOME PASSED' : `\nROUTINE STAYS HOME: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Two routines due on launch, every hour: one recorded as made in this folder, one in another.` })
}
