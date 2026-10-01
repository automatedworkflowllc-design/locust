// A commit per turn on Own branch, and Review changes (0.439).
//
//   node _tools/drive-review-changes.mjs [--packaged <exe>] [--tag <name>]
//
// Free model (LOCUST_FREE_MODEL, Nemotron by default): spends nothing.
//
// Idea #2 of PRODUCT-SUGGESTIONS-2026-09-28, which Colin picked. Wren works on
// her own branch (Own branch on) in a small repository. Turn 1 changes
// cart.py; turn 2 adds notes.md. After each, the thread must say what was
// saved on locust/wren, and git must hold one commit per turn on that branch,
// authored by Wren, with the trailers -- while the person's main is
// untouched. Then Review changes must show the two turns and the whole
// change, and a turn by itself must show only its own file.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
// LOCUST_RUNTIME=codex LOCUST_MODEL=gpt-6-luna (0.530, Sol's Workflow 3 left Codex unverified): spends, so LOCUST_SPEND=1.
const RUNTIME = process.env.LOCUST_RUNTIME ?? 'opencode'
const MODEL = process.env.LOCUST_MODEL ?? process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const OUT = join(recordRoot('review-changes-2026-09-28'), `review-changes-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-review-ws-')
await writeFile(join(workspace, 'cart.py'), 'def total(items):\n    return 0\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'cart'], workspace)
const mainBefore = (await git(['rev-parse', 'main'], workspace)).trim()

const drive = await startDrive({
  name: `review-changes-${tag}`, port: 9774, workspace, outPath: OUT,
  ...(RUNTIME === 'opencode' ? {} : { spends: true }),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', worktree: true, route: { runtime: RUNTIME, model: MODEL, mode: 'accept-edits', ...(RUNTIME === 'codex' ? { effort: 'low' } : {}) } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const saved = `(() => (document.querySelector('.lc-thread')?.innerText ?? '').split(/\\n/).filter((line) => /^Saved this turn on /.test(line.trim())).map((line) => line.trim()))()`
const branchLog = async () => (await git(['log', '--format=%an%x1f%s%x1f%(trailers:key=Locust-Turn,valueonly,separator=)', 'main..locust/wren'], workspace).catch(() => '')).trim().split('\n').filter((line) => line.length > 0)

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await sleep(800)

  const one = String(await drive.capture('Turn 1: cart.py', () => drive.evaluate(sendAndWaitScript('In cart.py, change `return 0` to `return sum(items)`. Change nothing else and do not run anything.', { waitSeconds: 300 }))))
  say(`  turn 1: ${one.slice(-160)}`)
  const afterOne = JSON.parse(JSON.stringify(await drive.evaluate(saved)))
  check('turn 1: the thread says what was saved on locust/wren', afterOne.length === 1 && /locust\/wren as [0-9a-f]{12}: .*cart\.py/.test(afterOne[0]), JSON.stringify(afterOne))

  const two = String(await drive.capture('Turn 2: notes.md', () => drive.evaluate(sendAndWaitScript('Create a new file notes.md containing exactly one line: summed items. Change nothing else and do not run anything.', { waitSeconds: 300 }))))
  say(`  turn 2: ${two.slice(-160)}`)
  const afterTwo = JSON.parse(JSON.stringify(await drive.evaluate(saved)))
  check('turn 2: a second receipt, naming notes.md', afterTwo.length === 2 && /notes\.md/.test(afterTwo[1]), JSON.stringify(afterTwo))

  const log = await branchLog()
  say(`  git log main..locust/wren: ${JSON.stringify(log)}`)
  check('git: one commit per turn on locust/wren, by Wren, each marked completed', log.length === 2 && log.every((line) => line.startsWith('Wren\x1f') && /completed$/.test(line)), JSON.stringify(log))
  check("git: the person's main is untouched", (await git(['rev-parse', 'main'], workspace)).trim() === mainBefore && (await readFile(join(workspace, 'cart.py'), 'utf8')) === 'def total(items):\n    return 0\n')
  check("git: nothing left uncommitted in Wren's tree", (await git(['status', '--porcelain'], join(workspace, '.locust', 'worktrees', 'tm_wren')).catch(() => 'no tree')).trim() === '')

  const review = JSON.parse(String(await drive.capture('Review changes: the whole change', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Review changes')
    if (!button) return JSON.stringify({ button: false })
    button.click()
    for (let i = 0; i < 40 && document.querySelectorAll('.lc-review__turn').length === 0; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 500))
    const panel = document.querySelector('aside[aria-label="Review changes"]')
    return JSON.stringify({
      button: true,
      head: panel?.querySelector('.lc-beside__title')?.textContent.trim() ?? '',
      turns: [...document.querySelectorAll('.lc-review__turn .lc-review__subject')].map((el) => el.textContent.trim()),
      files: [...(panel?.querySelectorAll('section[aria-label]') ?? [])].map((el) => el.getAttribute('aria-label'))
    })
  })()`))))
  say(`  review: ${JSON.stringify(review)}`)
  check('Review changes is offered, on locust/wren against main', review.button && review.head === 'locust/wren against main', JSON.stringify(review))
  check('it lists the whole change and the two turns, oldest first', review.turns?.length === 3 && review.turns[0] === 'The whole change' && /cart\.py/.test(review.turns[1] ?? '') && /notes\.md/.test(review.turns[2] ?? ''), JSON.stringify(review.turns))
  check('the whole change shows both files', review.files?.includes('cart.py') && review.files?.includes('notes.md'), JSON.stringify(review.files))

  const first = JSON.parse(String(await drive.capture('Review changes: turn 1 alone', () => drive.evaluate(`(async () => {
    document.querySelectorAll('.lc-review__turn')[1]?.click()
    await new Promise((r) => setTimeout(r, 1500))
    const panel = document.querySelector('aside[aria-label="Review changes"]')
    return JSON.stringify({ files: [...(panel?.querySelectorAll('section[aria-label]') ?? [])].map((el) => el.getAttribute('aria-label')), text: panel?.innerText.slice(0, 600) ?? '' })
  })()`))))
  say(`  turn 1 alone: ${JSON.stringify(first.files)}`)
  check('turn 1 alone shows only cart.py, with the new line', JSON.stringify(first.files) === '["cart.py"]' && /return sum\(items\)/.test(first.text), JSON.stringify(first.files))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on ${RUNTIME} / ${MODEL}, Accept edits, Own branch on; a small repository with cart.py.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
