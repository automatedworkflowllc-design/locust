// Does Remove on a teammate's own branch keep their uncommitted work (C1)?
//
//   node _tools/drive-worktree-keeps-work.mjs [--packaged <exe>] [--tag <name>]
//
// The code review's one critical: Settings > Own branches > Remove ran
// `git worktree remove --force` on one click, deleting every uncommitted and
// untracked file in the teammate's copy -- all of their work, since nothing
// commits it -- under "Removing one keeps its branch". Wren's copy is made the
// way the app makes it (branch locust/wren, .locust/worktrees/tm_wren) with an
// uncommitted REPORT.md in it. Remove must name REPORT.md and delete nothing;
// Keep it must leave it; only "Delete the changes and remove" takes the copy,
// and the branch stays. Sends nothing; no run starts.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `worktree-keeps-work-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-wtkeep-ws-')
const tree = join(workspace, '.locust', 'worktrees', 'tm_wren')
await mkdir(join(workspace, '.locust', 'worktrees'), { recursive: true })
await git(['worktree', 'add', '-q', '-b', 'locust/wren', tree, 'HEAD'], workspace)
await writeFile(join(tree, 'REPORT.md'), 'Wren’s findings, not committed.\n', 'utf8')
const exists = async (path) => stat(path).then(() => true, () => false)

const drive = await startDrive({
  name: 'worktree-keeps-work',
  port: 9553,
  workspace,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', worktree: true }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const row = `(() => {
  const r = [...document.querySelectorAll('.lc-worktreerow')].find((x) => /Wren/.test(x.textContent))
  return JSON.stringify(r == null ? { there: false } : {
    there: true,
    buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
    note: r.querySelector('.lc-worktreerow__note')?.textContent.trim() ?? ''
  })
})()`
const press = (label) => `(async () => {
  const r = [...document.querySelectorAll('.lc-worktreerow')].find((x) => /Wren/.test(x.textContent))
  const b = r && [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)})
  if (!b) return 'no button ' + ${JSON.stringify(label)}
  b.click()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return 'pressed'
})()`

try {
  await drive.capture('launch: Wren has an own branch with an uncommitted REPORT.md', () => drive.ready())
  await drive.capture('Settings: the Own branches list', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const r = [...document.querySelectorAll('.lc-worktreerow')].find((x) => /Wren/.test(x.textContent))
      if (r) { r.scrollIntoView({ block: 'center' }); return 'row there' }
    }
    return 'no row'
  })()`))
  check('the row is there', JSON.parse(String(await drive.evaluate(row))).there === true)

  await drive.capture('Remove: it names the work it would delete', () => drive.evaluate(press('Remove')))
  const asked = JSON.parse(String(await drive.evaluate(row)))
  check('Remove deletes nothing and names REPORT.md', /REPORT\.md/.test(asked.note) && /deletes it for good/.test(asked.note), asked.note)
  check('and asks: Keep it, or Delete the changes and remove', JSON.stringify(asked.buttons) === JSON.stringify(['Keep it', 'Delete the changes and remove']), JSON.stringify(asked.buttons))
  check('REPORT.md is still on disk', await exists(join(tree, 'REPORT.md')))

  await drive.capture('Keep it', () => drive.evaluate(press('Keep it')))
  const kept = JSON.parse(String(await drive.evaluate(row)))
  check('Keep it leaves the copy and its work', kept.there && JSON.stringify(kept.buttons) === JSON.stringify(['Remove']) && (await readFile(join(tree, 'REPORT.md'), 'utf8')).includes('findings'), JSON.stringify(kept))

  await drive.evaluate(press('Remove'))
  await drive.capture('Delete the changes and remove', () => drive.evaluate(press('Delete the changes and remove')))
  const gone = JSON.parse(String(await drive.evaluate(row)))
  check('only the explicit answer removes it', gone.there === false && !(await exists(tree)), JSON.stringify(gone))
  check('and the branch stays', (await git(['branch', '--list', 'locust/wren'], workspace)).includes('locust/wren'))
  say(failures === 0 ? '\nWORKTREE KEEPS WORK PASSED' : `\nWORKTREE KEEPS WORK: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren's own branch with an uncommitted REPORT.md; Settings > Own branches > Remove.` })
}
