// Is "Own branch could not be made" enforced on a routine's run too (M11)?
//
//   node _tools/drive-own-branch-every-start.mjs [--packaged <exe>] [--tag <name>]
//
// Wren has Own branch on, in a folder that is NOT a git repository, so the
// branch cannot be made. A direct message was refused with that reason; a
// room post, a relayed share or a routine step passed the same context to
// the one start every run shares, which never looked, and ran in the shared
// folder in Wren's write mode -- what Own branch was turned on to prevent.
// Here: a routine of Wren's, in Edit, run from the Team screen. It must be
// refused and say why, and no mission may be recorded.
//
// The route is the free OpenCode model, so the control's run spends nothing.

import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `own-branch-every-start-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

// Not a git repository: the branch cannot be made here.
const workspace = await mkdtemp(join(tmpdir(), 'locust-drive-ownbranch-ws-'))
await writeFile(join(workspace, 'README.md'), '# scratch\n\nA folder that is not a repository.\n', 'utf8')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-ownbranch-profile-'))
const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { ...FREE_ROUTE, mode: 'accept-edits' }
await writeFile(join(profilePath, 'routines.json'), JSON.stringify({
  schemaVersion: 1,
  routines: [{ routineId: 'rt_note', name: 'Leave a note', teammateId: 'tm_wren', route: ROUTE, steps: ['Create a file named routine-was-here.txt containing the word ok. Nothing else.'], learnedFrom: ['mission_1'], createdAt: T0, runs: 0 }]
}), 'utf8')

const drive = await startDrive({
  name: 'own-branch-every-start',
  port: 9575,
  workspace,
  profilePath,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, worktree: true, route: ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const missions = async () => (await readdir(join(profilePath, 'mission-ledger')).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
try {
  await drive.capture('launch: Wren, Own branch on, in a folder that is not a repository', () => drive.ready())
  await drive.resize(1215, 800)
  const run = String(await drive.capture('the Team screen: Run on the routine', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => /^\\s*Team\\s*$/.test(b.textContent ?? ''))?.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run')
      if (button && !button.disabled) { button.click(); await new Promise((r) => setTimeout(r, 3000)); return 'pressed' }
    }
    return 'no Run'
  })()`)))
  check('Run was pressed', run === 'pressed', run)
  await sleep(8000)
  const notice = String(await drive.evaluate(`[...document.querySelectorAll('.lc-screen [role="alert"], .lc-screen .lc-claim')].map((el) => el.textContent.trim()).find((text) => /^Not run:/.test(text)) ?? 'nothing'`))
  await drive.capture('what the Team screen says', () => drive.evaluate(`document.querySelector('.lc-screen')?.innerText.slice(0, 500) ?? ''`))
  const recorded = await missions()
  say(`  missions recorded: ${String(recorded.length)}`)
  check('the Team screen says the branch could not be made', /^Not run:/.test(notice) && /own branch/i.test(notice), notice)
  check('no mission was started in the shared folder', recorded.length === 0, `${String(recorded.length)} recorded`)
  say(failures === 0 ? '\nOWN BRANCH EVERY START PASSED' : `\nOWN BRANCH EVERY START: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren with Own branch on in a folder that is not a git repository; a routine of Wren's in Edit, run from the Team screen.` })
}
