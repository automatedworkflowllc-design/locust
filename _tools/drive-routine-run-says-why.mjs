// Does a routine's Run say why it did not start (M30)?
//
//   node _tools/drive-routine-run-says-why.mjs [--packaged <exe>] [--tag <name>]
//
// The code review's M30: a refused Run on the Team screen wrote its reason
// into the teammate dialog's error, which only that dialog shows -- nothing
// appeared. A routine of Wren's is seeded on a route this drive's no-spend
// guard refuses (Claude, not a free route), so the host refuses the Run
// before anything starts. The Team screen must say why. Sends nothing.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `routine-run-says-why-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-routinerun-profile-'))
const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { runtime: 'claude', model: 'haiku', mode: 'ask' }
await writeFile(join(profilePath, 'routines.json'), JSON.stringify({
  schemaVersion: 1,
  routines: [{ routineId: 'rt_nightly', name: 'Nightly note', teammateId: 'tm_wren', route: ROUTE, steps: ['Say hello.'], learnedFrom: ['mission_1'], createdAt: T0, runs: 0 }]
}), 'utf8')

const drive = await startDrive({
  name: 'routine-run-says-why',
  port: 9567,
  workspace: await scratchRepository('locust-drive-routinerun-ws-'),
  profilePath,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.capture('launch: Wren with a routine', () => drive.ready())
  await drive.resize(1215, 800)
  const run = String(await drive.capture('the Team screen: Run on the routine', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => /^\\s*Team\\s*$/.test(b.textContent ?? ''))?.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run')
      if (button && !button.disabled) { button.click(); await new Promise((r) => setTimeout(r, 2000)); return 'pressed' }
    }
    return 'no Run'
  })()`)))
  check('Run was pressed', run === 'pressed', run)
  await sleep(500)
  const notice = String(await drive.evaluate(`[...document.querySelectorAll('.lc-screen [role="alert"], .lc-screen .lc-claim')].map((el) => el.textContent.trim()).find((text) => /^Not run:|Nothing was started\./.test(text)) ?? 'nothing'`))
  await drive.capture('what the Team screen says', () => drive.evaluate(`document.querySelector('.lc-screen')?.innerText.slice(0, 400) ?? ''`))
  // Since W7 (6ca41823, 10/03) the notice is the host's own sentence, which says "Nothing was started."; it
  // dropped the "Not run:" prefix, which the sentence made redundant. Either says it did not run.
  check('the Team screen says why it did not run', /^Not run:|Nothing was started\./.test(notice), notice)
  say(failures === 0 ? '\nROUTINE RUN SAYS WHY PASSED' : `\nROUTINE RUN SAYS WHY: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren's routine on a route the no-spend guard refuses; Run on the Team screen.` })
}
