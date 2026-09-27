// A conversation, start to finish (fresh-eyes check, area "A conversation").
//
//   node _tools/drive-a-conversation.mjs [--packaged <exe>] [--tag <name>]
//
// Free model, in Edit. Wren is asked to change one word in README.md and to
// make notes.txt. What the conversation says is checked against the disk
// (git), and every stage is captured to be looked at:
//   1. while it works: the live line;
//   2. finished: the fold, the reply below it;
//   3. the fold opened: a row for each file it changed, and their diffs;
//   4. a changed file opened from its row;
//   5. Activity's Artifacts tab;
//   6. the finished conversation at 1120x720.

import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('a-conversation-2026-09-27'), `a-conversation-${tag}`)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-a-conversation-ws-')
const drive = await startDrive({
  name: `a-conversation-${tag}`, port: 9727, workspace, outPath: OUT, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const git = (...args) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' })
const THREAD = `JSON.stringify((() => {
  const thread = document.querySelector('.lc-thread')
  const fold = thread?.querySelector('.lc-activity')
  const lines = [...(thread?.querySelectorAll('.lc-agentline__body') ?? [])].filter((b) => !b.querySelector('.lc-card, .lc-activity, .lc-plan')).map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean)
  return {
    running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
    live: thread?.querySelector('[class*="lc-livestep"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    fold: fold?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    reply: lines.at(-1) ?? '',
    files: [...(thread?.querySelectorAll('.lc-filerow') ?? [])].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()).slice(0, 12),
    diffs: thread?.querySelectorAll('.lc-diff').length ?? 0,
    sideways: thread ? thread.scrollWidth > thread.clientWidth + 1 : null,
    // Is the newest reply on screen, inside the scrolling thread?
    replyInView: (() => {
      const bodies = [...(thread?.querySelectorAll('.lc-agentline__body') ?? [])].filter((b) => !b.querySelector('.lc-card, .lc-activity, .lc-plan') && b.innerText.trim())
      const last = bodies.at(-1)
      let scroller = last?.parentElement
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement
      if (!last || !scroller) return null
      const r = last.getBoundingClientRect(); const s = scroller.getBoundingClientRect()
      return r.top >= s.top - 1 && r.bottom <= s.bottom + 1
    })()
  }
})())`
const readThread = async () => JSON.parse(String(await drive.evaluate(THREAD)))

try {
  const before = await readFile(join(workspace, 'README.md'), 'utf8')
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(600)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'In README.md, change the word "scratch" on its first line to "practice". Then create a file notes.txt containing the single line: hello. Change nothing else. Then reply with the word DONE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
  })()`)
  // 1. While it works.
  let working
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    working = await readThread()
    if (working.running && working.live.length > 0) break
  }
  await drive.capture('while it works', () => JSON.stringify(working))
  check('while it works, a live line says so', working.running && working.live.length > 0, JSON.stringify({ running: working.running, live: working.live.slice(0, 80) }))
  // 2. Finished.
  for (let i = 0; i < 400; i += 1) {
    await sleep(750)
    if (!(await readThread()).running) break
  }
  await sleep(2500)
  const done = await readThread()
  await drive.capture('finished', () => JSON.stringify(done))
  // Each line is "XY path": the status is the first two columns, so the
  // output is not trimmed first (trimming ate the first line's leading space
  // and a letter of its name).
  const status = git('status', '--porcelain', '--untracked-files=all').split('\n').filter((line) => line.length > 3).map((line) => line.slice(3).trim())
  const after = await readFile(join(workspace, 'README.md'), 'utf8').catch(() => '')
  check('the task really happened on disk', status.includes('README.md') && status.includes('notes.txt') && after !== before && /practice/.test(after), JSON.stringify(status))
  check('finished: the reply is below the fold', /DONE/.test(done.reply), done.reply.slice(0, 120))
  // The fold's summary counts what git counts: 2 files, +2 -1 (README one line
  // changed, notes.txt one line added).
  const numstat = git('diff', '--numstat').trim()
  check('finished: the fold counts the files it changed, as git does', /2 files/.test(done.fold) && /\+2/.test(done.fold) && /[−-]1/.test(done.fold), `${done.fold.slice(0, 120)} || git: ${numstat} + notes.txt untracked`)
  // 3. The fold opened.
  const opened = JSON.parse(String(await drive.capture('the fold opened', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-thread .lc-activity')
    if (fold && fold.getAttribute('aria-expanded') === 'false') fold.click()
    await new Promise((r) => setTimeout(r, 700))
    return ${THREAD}
  })()`))))
  const rows = opened.files.join(' | ')
  check('the fold has a row for each file it changed', /README\.md/.test(rows) && /notes\.txt/.test(rows), rows.slice(0, 200))
  check('and nothing in the conversation scrolls sideways', opened.sideways === false, String(opened.sideways))
  // 4. A changed file, opened from its row.
  const viewer = String(await drive.capture('README.md opened from its row', () => drive.evaluate(`(async () => {
    // The row's own click opens its diff in place; the square "Open README.md"
    // button beside it opens the file.
    document.querySelector('.lc-thread button[aria-label="Open README.md"]')?.click()
    await new Promise((r) => setTimeout(r, 1500))
    // The viewer itself (.lc-viewer), its name and its body -- a loose
    // [class*=viewer] matched the app's own "has-viewer" root and passed on
    // any text at all.
    const viewer = document.querySelector('.lc-viewer')
    if (!viewer) return 'no viewer'
    const name = viewer.querySelector('.lc-viewer__name')?.textContent.trim() ?? ''
    const body = (viewer.querySelector('.lc-viewer__prose, .lc-viewer__code') ?? viewer).innerText.replace(/\\s+/g, ' ').slice(0, 160)
    return 'viewer: ' + name + ' :: ' + body
  })()`)))
  check('the Open button beside a changed file opens it, as it is now', /^viewer: README\.md :: .*practice/.test(viewer), viewer.slice(0, 160))
  // 5. Activity's Artifacts tab.
  const artifacts = String(await drive.capture('Activity: the Artifacts tab', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-viewer__close')?.click()
    await new Promise((r) => setTimeout(r, 500))
    if (!document.querySelector('.lc-inspector')) [...document.querySelectorAll('button')].find((b) => /Activity/.test(b.innerText || ''))?.click()
    await new Promise((r) => setTimeout(r, 800))
    ;[...document.querySelectorAll('.lc-inspector button, .lc-inspector [role=tab]')].find((b) => /^Artifacts$/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 800))
    return document.querySelector('.lc-inspector')?.innerText.replace(/\\s+/g, ' ').slice(0, 400) ?? 'no inspector'
  })()`)))
  check('Artifacts lists both files', /README\.md/.test(artifacts) && /notes\.txt/.test(artifacts), artifacts.slice(0, 200))
  // 6. The finished conversation on a small window.
  await drive.evaluate(`[...document.querySelectorAll('button')].find((b) => /Activity/.test(b.innerText || ''))?.click()`)
  await drive.resize(1120, 720)
  await sleep(1200)
  const small = JSON.parse(String(await drive.capture('the finished conversation at 1120x720', () => drive.evaluate(THREAD))))
  check('1120x720: nothing scrolls sideways, the reply still there', small.sideways === false && /DONE/.test(small.reply), JSON.stringify({ sideways: small.sideways, reply: small.reply.slice(0, 40) }))
  // Seen in this drive's own capture: after the window shrank, "DONE" was below
  // the thread's view. A person who was at the newest reply stays there.
  check('1120x720: the newest reply is still on screen after the window shrank', small.replyInView === true, String(small.replyInView))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on a free model in Edit; one small real task in a scratch repository.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
