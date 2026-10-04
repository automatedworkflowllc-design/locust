// Fresh-eyes areas 16-22: one AI agent on the everyday jobs.
//
//   node _tools/drive-agent-everyday-jobs.mjs --runtime <id> --model <id> [--spend] [--packaged <exe>] [--tag <name>]
//
// One teammate, Ada, on the route given, in one conversation:
//   1. answer a question about the project (reads the README);
//   2. edit a file, in Accept edits -- read back from disk;
//   3. in Approve each, ask before making a file; approved, it is made;
//   4. stop a long answer part-way;
//   5. pick back up after the stop.
// --spend marks a route that costs money (LOCUST_SPEND=1 is then required by
// drive-lib); a free route needs neither.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { recordRoot, say, scratchRepository, sleep, startDrive, openTeammateScript } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const runtime = arg('--runtime') ?? 'opencode'
const model = arg('--model') ?? process.env.LOCUST_FREE_MODEL ?? 'opencode/nemotron-3-ultra-free'
const spends = process.argv.includes('--spend')
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('agent-everyday-jobs-2026-09-28'), `${runtime}-${tag}`)
await mkdir(OUT, { recursive: true })

// --workspace <dir>: a folder the runtime already knows (Antigravity works only
// inside one). Nothing in it is changed but the two files the jobs make, and
// those are removed afterwards if they were not there before.
const given = arg('--workspace')
let workspace
if (given === undefined) {
  workspace = await scratchRepository('locust-drive-everyday-jobs-ws-', 'A small web shop: a Node backend and a pricing page.\n')
  await writeFile(join(workspace, 'README.md'), '# Corner Shop\n\nA small web shop for a neighbourhood bakery: a Node backend that takes orders, and a pricing page.\n', 'utf8')
  execFileSync('git', ['commit', '-qam', 'readme'], { cwd: workspace })
} else {
  workspace = given
}
const MADE = ['NOTES.md', 'TODO.md']
const existedBefore = new Set((await Promise.all(MADE.map(async (file) => ((await readFile(join(workspace, file), 'utf8').catch(() => undefined)) === undefined ? undefined : file)))).filter(Boolean))
const drive = await startDrive({
  name: `everyday-${runtime}-${tag}`, port: 9751, workspace, outPath: OUT,
  ...(spends ? { spends: true } : {}),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime, model, mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const RUNNING = `document.querySelector('button[aria-label^="Stop the running"]') !== null`
const lastTurn = `(() => { const t = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''; return t.slice(-700) })()`
/** Send, then wait until the run ends -- or, with untilApproval, until an approval card is up. */
const send = (text, { untilApproval = false, waitSeconds = 300 } = {}) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  let sent = false
  for (let i = 0; i < 120 && !sent; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); sent = true }
  }
  if (!sent) return 'not sent'
  for (let i = 0; i < ${String(waitSeconds * 2)}; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (${untilApproval} && document.querySelector('[role=group][aria-label="Approval required"]')) return 'approval waiting'
    if (i > 6 && !(${RUNNING})) return 'ended'
  }
  return 'timed out'
})()`)
const mode = (name) => drive.evaluate(`(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const item = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => new RegExp('^' + ${JSON.stringify(name)}).test(b.innerText.trim()))
  // Not offered: say what the menu says about it, which is the reason a person gets.
  if (!item || item.disabled) {
    const said = item ? (item.innerText + ' ' + (item.title || item.getAttribute('aria-description') || '')).replace(/\\s+/g, ' ').trim() : '(no such row)'
    control.click()
    return ${JSON.stringify(name)} + ' not offered: ' + said
  }
  item.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`)
const onDisk = async (file) => readFile(join(workspace, file), 'utf8').catch(() => undefined)

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  await drive.evaluate(openTeammateScript('Ada'))

  // 1. Answer.
  const answered = await send('In two sentences: what is this project, going by its README? Change nothing.')
  const one = String(await drive.capture('1. an answer', () => drive.evaluate(lastTurn)))
  check('1. it answers, from the README', answered === 'ended' && (given === undefined ? /bakery|shop|order|pricing/i.test(one) : !/could not continue/i.test(one)) && !/failed|stopped/i.test(one.slice(-160)), `${String(answered)} || ${one.slice(-240)}`)

  // 2. Edit a file.
  const edited = await send('Add the line "Launch: Friday" at the end of NOTES.md, creating the file if it does not exist. Then say done in one word.')
  const notes = await onDisk('NOTES.md')
  await drive.capture('2. a file edited', () => drive.evaluate(lastTurn))
  check('2. the file is edited, on disk', edited === 'ended' && /Launch: Friday/.test(notes ?? ''), `${String(edited)} || NOTES.md: ${JSON.stringify(notes)}`)

  // 3. Ask before acting.
  const switched = String(await mode('Approve each'))
  if (/not offered/.test(switched)) {
    // Only Codex, OpenCode and Copilot can stop and ask (status.ts); the menu must say so.
    check('3. Approve each is not offered here, and the menu says why', /cannot stop and ask/i.test(switched), switched)
  } else {
  const waiting = await send('Create a file TODO.md containing the single line "- ship it". Then say done in one word.', { untilApproval: true })
  const card = String(await drive.capture('3. it asks first', () => drive.evaluate(`document.querySelector('[role=group][aria-label="Approval required"]')?.innerText.replace(/\\s+/g, ' ') ?? 'no approval card'`)))
  const before = await onDisk('TODO.md')
  check('3. in Approve each it asks before making the file, and has not made it', /^mode: Approve/.test(switched) && waiting === 'approval waiting' && before === undefined, `${switched} || ${String(waiting)} || ${card.slice(0, 160)} || TODO.md before: ${JSON.stringify(before)}`)
  const approved = String(await drive.evaluate(`(async () => {
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      const card = document.querySelector('[role=group][aria-label="Approval required"]')
      if (card) [...card.querySelectorAll('button')].find((b) => /^Approve once/.test(b.innerText.trim()))?.click()
      if (i > 5 && !(${RUNNING})) return 'ended'
    }
    return 'still running'
  })()`))
  const todo = await onDisk('TODO.md')
  await drive.capture('3. approved', () => drive.evaluate(lastTurn))
  check('3. approved, the file is made', approved === 'ended' && /ship it/.test(todo ?? ''), `${approved} || TODO.md: ${JSON.stringify(todo)}`)
  await mode('Edit')
  }

  // 4. Stop part-way.
  const started = await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Write the numbers from 1 to 400, one per line, as plain text. Use no tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 60; i += 1) { await new Promise((r) => setTimeout(r, 250)); if (${RUNNING}) break }
    await new Promise((r) => setTimeout(r, 6000))
    const stop = document.querySelector('button[aria-label^="Stop the running"]')
    if (!stop) return 'ended before it could be stopped'
    stop.click()
    for (let i = 0; i < 120; i += 1) { await new Promise((r) => setTimeout(r, 500)); if (!(${RUNNING})) return 'stopped' }
    return 'still running after Stop'
  })()`)
  const stopped = String(await drive.capture('4. stopped part-way', () => drive.evaluate(lastTurn)))
  check('4. Stop ends the run and says so, without claiming no work was done', started === 'stopped' && /stopped|cancel/i.test(stopped) && !/before it did any work/.test(stopped), `${String(started)} || ${stopped.slice(-200)}`)

  // 5. Pick back up.
  const resumed = await send('Never mind the long list: give me just the numbers 1 to 5, on one line.')
  const five = String(await drive.capture('5. picked back up', () => drive.evaluate(lastTurn)))
  check('5. after the stop it carries on and answers', resumed === 'ended' && /1\D{1,3}2\D{1,3}3\D{1,3}4\D{1,3}5/.test(five.slice(-200)), `${String(resumed)} || ${five.slice(-200)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (given !== undefined) {
    for (const file of MADE) if (!existedBefore.has(file)) await rm(join(workspace, file), { force: true })
  }
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Ada on ${runtime} / ${model}; one conversation, five everyday jobs.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
