// Codex's /review, /compact and /init, and Claude Code's commands before any
// run (0.428).
//
//   node _tools/drive-codex-commands.mjs [--packaged <exe>] [--tag <name>] [--model <id>]
//
// Spends: Codex (gpt-6-luna by default), three short turns. Run with
// LOCUST_SPEND=1. Claude Code is never sent a message here.
//
// Colin, 2026-09-28, on 0.427, a Claude Code teammate and a / menu with
// Locust's own commands only: "am i doing something wrong?" He was not: the
// list came only from a run. So the first check is Cleo's menu, before any
// run and without one. Then Ada (Codex, Ask) reviews an uncommitted change
// that breaks calc.py and compacts the conversation; Bea (Codex, Accept
// edits) runs /init and an AGENTS.md appears.
//
// PRIVACY. Claude Code lists the person's own commands and skills: read as
// counts only, never pictured. Codex's three are Locust's list.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = arg('--model') ?? 'gpt-6-luna'
const OUT = join(recordRoot('codex-commands-2026-09-28'), `codex-commands-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-codex-cmds-ws-')
await writeFile(join(workspace, 'calc.py'), 'def add(a, b):\n    return a + b\n', 'utf8')
await git(['add', 'calc.py'], workspace)
await git(['commit', '-q', '-m', 'add calc'], workspace)
await writeFile(join(workspace, 'calc.py'), 'def add(a, b):\n    return a - b\n', 'utf8')

const drive = await startDrive({
  name: `codex-commands-${tag}`, port: 9765, workspace, outPath: OUT, spends: true, launchElsewhere: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_cleo', name: 'Cleo', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } },
      { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'codex', model: MODEL, effort: 'low', mode: 'ask' } },
      { teammateId: 'tm_bea', name: 'Bea', hue: 'lime', role: 'Docs & QA', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'codex', model: MODEL, effort: 'low', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const type = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.focus()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  return 'typed'
})()`
const press = (key) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 500))
  return document.querySelector('form.command-dock textarea').value
})()`
const NAME_OF = `(row) => {
  const whole = row.querySelector('.lc-slash__name')?.textContent ?? ''
  const hint = row.querySelector('.lc-slash__hint')?.textContent ?? ''
  return whole.slice(0, whole.length - hint.length).trim().replace(/^\\//, '')
}`
/** The menu as counts and yes/no, waiting up to half a minute for a group. */
const menuFor = (group, names) => `(async () => {
  let read
  for (let i = 0; i < 60; i += 1) {
    const rows = [...document.querySelectorAll('.lc-slash .lc-slash__item')]
    const listed = rows.map(${NAME_OF})
    const groups = [...document.querySelectorAll('.lc-slash .lc-slash__group')].map((g) => g.textContent.trim())
    read = { open: document.querySelector('.lc-slash') !== null, rows: rows.length, groups, has: Object.fromEntries(${JSON.stringify(names)}.map((name) => [name, listed.includes(name)])) }
    if (groups.includes(${JSON.stringify(group)})) break
    await new Promise((r) => setTimeout(r, 500))
  }
  return JSON.stringify(read)
})()`
const sendAndWait = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 2500))
  return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ')
})()`
/** Type the command's start, take its row with Enter, and say what the box then holds. */
const pick = async (typed) => {
  await drive.evaluate(type(typed))
  await sleep(300)
  return String(await drive.evaluate(press('Enter')))
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)

  await drive.evaluate(openTeammateScript('Cleo'))
  await sleep(800)
  await drive.evaluate(type('/'))
  const cleo = JSON.parse(String(await drive.evaluate(menuFor('Claude Code', ['compact', 'init', 'security-review']))))
  await drive.evaluate(press('Escape'))
  say(`  Cleo, before any run: ${JSON.stringify(cleo)}`)
  check("Claude Code's commands are in the menu before any Claude run", cleo.groups.includes('Claude Code') && cleo.has.compact && cleo.has.init, JSON.stringify(cleo))

  await drive.evaluate(openTeammateScript('Ada'))
  await sleep(800)
  await drive.evaluate(type('/'))
  const ada = JSON.parse(String(await drive.capture('Ada: a bare slash', () => drive.evaluate(menuFor('Codex', ['review', 'compact', 'init'])))))
  await drive.evaluate(press('Escape'))
  check("Codex's /review, /compact and /init are listed under Codex", ada.groups.includes('Codex') && ada.has.review && ada.has.compact && ada.has.init, JSON.stringify(ada))

  const boxedReview = await pick('/rev')
  check('Enter on /rev writes "/review "', boxedReview === '/review ', boxedReview)
  if (boxedReview !== '/review ') await drive.evaluate(type('/review '))
  const reviewed = String(await drive.capture('/review sent', () => drive.evaluate(sendAndWait)))
  const reviewReply = reviewed.slice(reviewed.lastIndexOf('/review') + 7)
  say(`  review: ${reviewReply.slice(0, 300)}`)
  check("Codex ran its own review and found that add subtracts", /subtract|a - b|difference|minus/i.test(reviewReply), reviewReply.slice(0, 300))
  check('and the review is said once, with no review-mode step', !/enteredReviewMode|exitedReviewMode/.test(reviewed), '')

  const boxedCompact = await pick('/comp')
  if (boxedCompact !== '/compact ') await drive.evaluate(type('/compact '))
  const compacted = String(await drive.capture('/compact sent', () => drive.evaluate(sendAndWait)))
  check('/compact summarized the conversation, as asked', compacted.includes('Codex summarized the conversation so far, as asked'), compacted.slice(-300))

  await drive.evaluate(openTeammateScript('Bea'))
  await sleep(800)
  const boxedInit = await pick('/ini')
  if (boxedInit !== '/init ') await drive.evaluate(type('/init '))
  const inited = String(await drive.capture('/init sent', () => drive.evaluate(sendAndWait)))
  const agents = await readFile(join(workspace, 'AGENTS.md'), 'utf8').catch(() => '')
  say(`  init: ${inited.slice(-200)}`)
  check('/init wrote an AGENTS.md for the folder', agents.trim().length > 40 && /calc|python/i.test(agents), JSON.stringify({ length: agents.length }))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Cleo on Claude Code (never sent anything); Ada (Ask) and Bea (Accept edits) on Codex / ${MODEL}, low; the folder has an uncommitted change that breaks calc.py.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
