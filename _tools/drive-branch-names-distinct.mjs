// Do two teammates whose names fold to one branch both get a tree (M17)?
//
//   node _tools/drive-branch-names-distinct.mjs [--packaged <exe>] [--tag <name>]
//
// "Dev 1" and "Dev-1" both have Own branch on; both names fold to
// locust/dev-1. Dev 1's tree is made first (with git, the way Locust makes
// it), so the branch is checked out. Then the person messages Dev-1. Git
// refused a second tree on that branch, and the message was refused with
// git's own text: "fatal: 'locust/dev-1' is already used by worktree at ...".
// Now Dev-1 gets a branch with its id on the end, and the run starts there.
//
// On the free OpenCode model, so the run spends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, git, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `branch-names-distinct-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-branchnames-ws-')
await mkdir(join(workspace, '.locust', 'worktrees'), { recursive: true })
await git(['worktree', 'add', '-q', '-b', 'locust/dev-1', join(workspace, '.locust', 'worktrees', 'tm_devone'), 'HEAD'], workspace)
const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { ...FREE_ROUTE, mode: 'accept-edits' }
const drive = await startDrive({
  name: 'branch-names-distinct',
  port: 9583,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_devone', name: 'Dev 1', hue: 'lime', role: 'Code & Migrations', createdAt: T0, worktree: true, route: ROUTE },
      { teammateId: 'tm_devdash', name: 'Dev-1', hue: 'blue', role: 'Code & Migrations', createdAt: T0, worktree: true, route: ROUTE }
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
try {
  await drive.capture('launch: Dev 1 already on locust/dev-1', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Dev-1')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.capture('message Dev-1', () => drive.evaluate(sendAndWaitScript('Reply with the single word ready. Do not edit any files.', { waitSeconds: 180 })))
  await sleep(1000)
  const refused = String(await drive.evaluate(`(document.body.innerText.match(/[^\\n]*already used by worktree[^\\n]*/) ?? [''])[0].slice(0, 240)`))
  await drive.capture('what the conversation shows', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-300) ?? ''`))
  const trees = (await git(['worktree', 'list', '--porcelain'], workspace)).split(/\r?\n/).filter((line) => line.startsWith('branch ')).map((line) => line.slice('branch refs/heads/'.length))
  say(`  branches checked out: ${trees.join(', ')}`)
  check('Dev-1 was not refused with git’s text', refused === '', refused || undefined)
  check('Dev-1 has a tree of its own on a branch of its own', trees.some((branch) => branch.startsWith('locust/dev-1-')), trees.join(', '))
  say(failures === 0 ? '\nBRANCH NAMES DISTINCT PASSED' : `\nBRANCH NAMES DISTINCT: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Dev 1 and Dev-1, both Own branch, both folding to locust/dev-1; Dev 1's tree made first; a message to Dev-1.` })
}
