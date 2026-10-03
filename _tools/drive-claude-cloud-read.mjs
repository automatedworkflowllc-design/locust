// Claude's cloud, READ in Locust (0.558): what a session said and changed.
//
//   node _tools/drive-claude-cloud-read.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: "why cant we make this work for the user? ... exhaust all
// possibilities before simply giving up". A cloud session already sent from
// this checkout (session_01ARukdj17v2vKLMYm6pc6WE, Haiku: "create
// cloud-read-check.txt and commit it") is seeded into the store. In the
// packaged app: Cloud tasks, "Show what it did" -- Claude Code brings it in
// out of sight; the row shows the conversation and the change; Apply brings
// the file into this folder, not committed, and the reading's worktree goes.
// No Claude Code window opens. Makes no model call: teleport fetches only.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = resolve(import.meta.dirname, '..')
const applied = join(workspace, 'cloud-read-check.txt')
if (existsSync(applied)) throw new Error(`${applied} is already there; this drive brings it in.`)

const claudeWindows = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match '/k' -and $_.CommandLine -match '--cloud|--teleport' }).Count"], { encoding: 'utf8' }).trim())
const readingWorktrees = () => execFileSync('git', ['worktree', 'list'], { cwd: workspace, encoding: 'utf8' }).split('\n').filter((line) => /locust-cloud-/.test(line)).length

const id = 'cc_975c45de5d614196a71f'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `claude-cloud-read-${tag}`,
  port: 9862,
  workspace,
  outPath: join(recordRoot('claude-cloud-read-2026-10-02'), tag),
  files: {
    'claude-cloud.json': { sessions: [{ id, startedAt: '2026-10-03T00:56:24.790Z', prompt: 'Create a new file named cloud-read-check.txt containing the single line: read back by Locust. Commit it on your branch. Change nothing else and open no pull request.', folder: workspace, sessionId: 'session_01ARukdj17v2vKLMYm6pc6WE', url: 'https://claude.ai/code/session_01ARukdj17v2vKLMYm6pc6WE', title: 'cloud-read-check.txt file creation' }] }
  },
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_clay', name: 'Clay', hue: 'violet', role: 'Custom', roleTitle: 'Code', createdAt: '2026-10-02T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 600)}`}`)
}
const click = (pattern, scope = 'document') => `(() => {
  const b = [...${scope}.querySelectorAll('button')].find((x) => ${pattern}.test((x.innerText + ' ' + (x.getAttribute('aria-label') ?? '') + ' ' + (x.getAttribute('title') ?? '')).trim()))
  b?.click()
  return !!b
})()`
try {
  const before = claudeWindows()
  await drive.ready()
  await drive.resize(1209, 770)
  // Clay, then Cloud in the chat-type menu: the panel opens with this folder's sessions.
  await drive.evaluate(`(async () => {
    const clay = [...document.querySelectorAll('button')].find((b) => /Clay/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    clay?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 1
  })()`)
  await drive.waitFor(`!!document.querySelector('.lc-control--chatmode')`, { timeoutMs: 60_000, what: 'the chat-type chip' })
  await drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 500))
    ;[...document.querySelectorAll('.lc-menu__item')].find((b) => /^Cloud/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 1
  })()`)
  await drive.waitFor(`!!document.querySelector('.lc-cloudtask')`, { timeoutMs: 30_000, what: 'the session row' })
  const row = String(await drive.capture('The session, before reading', () => drive.evaluate(`document.querySelector('.lc-cloudtask')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)))
  check('the row offers to show what it did', /Show what it did/.test(row) && /See it on claude\.ai/.test(row), row)
  await drive.evaluate(click('/^Show what it did/', "document.querySelector('.lc-cloudtask')"))
  await sleep(1500)
  const busy = String(await drive.evaluate(`document.querySelector('.lc-cloudtask')?.innerText ?? ''`))
  check('it says it is reading', /Reading it…/.test(busy), busy.slice(0, 200))
  let windowsSeen = 0
  for (let waited = 0; waited < 200_000; waited += 2000) {
    windowsSeen = Math.max(windowsSeen, claudeWindows() - before)
    if (await drive.evaluate(`!!document.querySelector('.lc-cloudtask__read, .lc-cloudtask [role=alert]')`)) break
    await sleep(2000)
  }
  const read = JSON.parse(String(await drive.capture('What it did, read', () => drive.evaluate(`JSON.stringify({
    text: document.querySelector('.lc-cloudtask')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    asks: [...document.querySelectorAll('.lc-cloudtask__ask')].map((x) => x.innerText),
    replies: [...document.querySelectorAll('.lc-cloudtask__reply')].map((x) => x.innerText),
    files: [...document.querySelectorAll('.lc-cloudtask .lc-review__name')].map((x) => x.innerText),
    diffRows: document.querySelectorAll('.lc-cloudtask .lc-diff').length
  })`))))
  check('no Claude Code window opened', windowsSeen === 0, `windows: ${String(windowsSeen)}`)
  check('the conversation is shown: its task and its answer', read.asks.some((x) => /cloud-read-check\.txt/.test(x)) && read.replies.some((x) => /Created cloud-read-check\.txt|committed/i.test(x)), JSON.stringify({ asks: read.asks, replies: read.replies, text: read.text.slice(0, 400) }))
  check('its change is shown as a diff of the file it made', read.files.includes('cloud-read-check.txt') && read.diffRows > 0, JSON.stringify(read.files))
  check('the folder is untouched before Apply', !existsSync(applied))
  check('Check again is offered', /Check again/.test(read.text))
  await drive.evaluate(click('/^Apply to this folder/', "document.querySelector('.lc-cloudtask')"))
  await drive.waitFor(`/Applied|does not apply|could not be applied|Check it again/.test(document.querySelector('.lc-cloudtask')?.innerText ?? '')`, { timeoutMs: 60_000, what: 'the Apply answer' })
  const after = String(await drive.capture('Applied', () => drive.evaluate(`document.querySelector('.lc-cloudtask')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)))
  check('Apply brings the file in, not committed', existsSync(applied) && readFileSync(applied, 'utf8').trim() === 'read back by Locust' && /not committed/.test(after), after.slice(-300))
  check('the reading’s worktree is gone after Apply', readingWorktrees() === 0)
  check('still no Claude Code window', claudeWindows() - before === 0)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  rmSync(applied, { force: true })
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A Haiku cloud session already sent from this checkout, seeded; Show what it did, then Apply.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
