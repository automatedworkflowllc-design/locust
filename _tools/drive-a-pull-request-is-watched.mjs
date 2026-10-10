// The folder's pull request, and Watch beside it (0.731), on a real GitHub pull request.
//
//   node _tools/drive-a-pull-request-is-watched.mjs [--packaged <exe>]
//
// A scratch clone of octocat/Hello-World checked out to one of its open pull requests with `gh pr checkout`
// (read only on GitHub: nothing is pushed, opened or commented). Wren, on the free model, answers one word so a
// conversation is open; the header then shows the pull request, and Watch beside it turns to Watching. What a
// watch says when something changes is covered by its tests (a-pull-request-can-be-watched.test.ts): a check
// cannot be made to fail on someone else's pull request.

import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const root = await mkdtemp(join('C:/work/scratch', 'locust-pr-watch-'))
const run = (program, args, cwd) => execFileSync(program, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
run('gh', ['repo', 'clone', 'octocat/Hello-World', 'Hello-World', '--', '-q'], root)
const workspace = join(root, 'Hello-World')
const number = run('gh', ['pr', 'list', '--state', 'open', '--limit', '1', '--json', 'number', '--jq', '.[0].number'], workspace).trim()
run('gh', ['pr', 'checkout', number], workspace)
say(`pull request #${number}, branch ${run('git', ['branch', '--show-current'], workspace).trim()}`)

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-pull-request-is-watched',
  port: 9596,
  workspace,
  outPath: join(recordRoot('a-pull-request-is-watched-2026-10-10'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, 'Reply with the single word ok and run nothing.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'done'
  })()`)
  const chip = String(
    await drive.capture('the pull request in the header', () =>
      drive.evaluate(`(async () => {
        for (let i = 0; i < 40 && !document.querySelector('.lc-prchip'); i += 1) await new Promise((r) => setTimeout(r, 500))
        const chip = document.querySelector('.lc-prchip')
        const watch = document.querySelector('.lc-prwatch')
        return (chip?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no chip') + ' | ' + (watch?.innerText.trim() ?? 'no watch')
      })()`)
    )
  )
  check('the header shows the pull request, with Watch beside it', chip.includes(`#${number}`) && /\| Watch$/.test(chip), chip)
  const pressed = String(
    await drive.capture('Watch pressed', () =>
      drive.evaluate(`(async () => {
        document.querySelector('.lc-prwatch')?.click()
        for (let i = 0; i < 20 && document.querySelector('.lc-prwatch')?.getAttribute('aria-pressed') !== 'true'; i += 1) await new Promise((r) => setTimeout(r, 250))
        const watch = document.querySelector('.lc-prwatch')
        return (watch?.innerText.trim() ?? 'no watch') + ' · pressed ' + watch?.getAttribute('aria-pressed') + ' · kept ' + window.localStorage.getItem('locust.watchedPullRequests')
      })()`)
    )
  )
  check('pressing it watches: the host says so, and this window keeps it', pressed.startsWith('Watching · pressed true') && pressed.includes(`/pull/${number}`), pressed)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. octocat/Hello-World #${number}, checked out; Watch pressed.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
