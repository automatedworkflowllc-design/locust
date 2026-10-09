// A routine that works in a copy: nothing lands until Keep (0.533).
//
//   node _tools/drive-a-routine-in-a-copy.mjs [--packaged <exe>] [--tag <name>]
//
// Sol's 0.528 pass, as an office user: "I would not trust a file routine's
// no-change description after seeing it create files." Routines > New
// routine, a step that writes receipt.md, Change files and "In a copy, you
// keep", saved, then Run. The folder must not have receipt.md; the routine's
// card must say it changed it and offer Keep. Keep: receipt.md is in the
// folder. Then receipt.md is removed by hand, Run again, Discard (asked
// first): the folder still has no receipt.md. A free OpenCode teammate
// (Fledge Alpha), in Edit: spends nothing.

import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/muse-spark-1.3-contributor-free'
const workspace = await scratchRepository('locust-drive-routine-copy-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `routine-in-a-copy-${tag}`,
  port: 9855,
  workspace,
  outPath: join(recordRoot('a-routine-in-a-copy-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_cedar', name: 'Cedar', hue: 'lime', role: 'Custom', roleTitle: 'Office', createdAt: '2026-10-01T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const exists = (path) => stat(path).then(() => true, () => false)
const RECEIPT = join(workspace, 'receipt.md')
const STEP = 'Create a file named receipt.md in the folder you are working in, holding exactly the words RECEIPT OK. Then reply with the word DONE.'
const DIALOG = `document.querySelector('[role=dialog]')`
const row = `[...document.querySelectorAll('.lc-routinerow:not(.lc-routineadd)')].find((r) => /Desk receipt/.test(r.innerText))`
const openRoutines = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  return 1
})()`
// Run from the card, then wait for the routine to say it finished, on its card.
const runAndWait = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  const card = ${row}
  ;[...(card?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Run')?.click()
  for (let i = 0; i < 400; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    const now = ${row}
    if (now?.querySelector('.lc-routinechanges')) return 'waiting: ' + now.querySelector('.lc-routinechanges').innerText.replace(/\\s+/g, ' ').trim()
    if (i > 20 && now && /run d+ times?/.test(now.innerText) && !now.querySelector('.lc-routinechanges')) return 'finished, nothing waiting: ' + now.innerText.replace(/\\s+/g, ' ').trim()
  }
  return 'never finished: ' + ((${row})?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no row')
})()`
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openRoutines)
  const made = String(await drive.capture('New routine: Change files, in a copy', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-screen__actions button')].find((b) => b.innerText.trim() === 'New routine')?.click()
    await new Promise((r) => setTimeout(r, 800))
    const dialog = ${DIALOG}
    if (!dialog) return 'no dialog'
    const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    const name = dialog.querySelector('#routine-name')
    input.call(name, 'Desk receipt'); name.dispatchEvent(new Event('input', { bubbles: true }))
    const step = dialog.querySelector('textarea[aria-label="Step 1"]')
    area.call(step, ${JSON.stringify(STEP)}); step.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    ;[...dialog.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'In a copy, you keep')?.click()
    await new Promise((r) => setTimeout(r, 400))
    return dialog.innerText.replace(/\\s+/g, ' ').trim()
  })()`)))
  check('the dialog offers "In a copy, you keep", and says nothing lands until you keep it', /When a run finishes, its changes wait under Routines/.test(made), made)
  const saved = String(await drive.evaluate(`(async () => {
    ;[...(${DIALOG})?.querySelectorAll('button') ?? []].find((b) => b.innerText.trim() === 'Save routine')?.click()
    for (let i = 0; i < 20 && ${DIALOG}; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 600))
    return (${row})?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no row'
  })()`))
  check('saved, the routine is on the screen', /Desk receipt/.test(saved), saved)

  const first = String(await drive.capture('run 1: its changes, waiting', () => drive.evaluate(runAndWait)))
  // What the run itself said, kept beside the card's frame: a run with nothing waiting needs its reasons on record.
  await drive.capture('run 1: its conversation', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-convrow button.lc-conv')][0]?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').trim().slice(-1500) ?? 'no thread'
  })()`))
  await drive.evaluate(openRoutines)
  check('run 1 finished with its change waiting on the card, receipt.md named', /^waiting: /.test(first) && /receipt\.md/.test(first) && /Nothing has reached the folder/.test(first), first)
  check('and the folder has no receipt.md: nothing landed', !(await exists(RECEIPT)))
  const runLocked = String(await drive.evaluate(`(${row})?.querySelector('button')?.innerText ?? ''`))
  const locked = Boolean(await drive.evaluate(`[...((${row})?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === 'Run')?.disabled === true`))
  check('Run waits while the changes do', locked, runLocked)

  const kept = String(await drive.capture('Keep pressed', () => drive.evaluate(`(async () => {
    ;[...((${row})?.querySelectorAll('.lc-routinechanges button') ?? [])].find((b) => b.innerText.trim() === 'Keep')?.click()
    for (let i = 0; i < 20 && (${row})?.querySelector('.lc-routinechanges'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 600))
    return document.querySelector('.lc-claim')?.innerText.replace(/\\s+/g, ' ').trim() ?? ((${row})?.querySelector('.lc-routinechanges') ? 'still waiting' : 'gone')
  })()`)))
  const words = await readFile(RECEIPT, 'utf8').catch(() => '')
  check('Keep wrote receipt.md into the folder, and says so', /RECEIPT OK/.test(words) && /Kept: 1 file written into the folder/.test(kept), `${kept} | ${words.trim()}`)

  await rm(RECEIPT, { force: true })
  const second = String(await drive.capture('run 2: its changes, waiting', () => drive.evaluate(runAndWait)))
  check('run 2 finished with its change waiting', /^waiting: /.test(second) && /receipt\.md/.test(second), second)
  const discarded = String(await drive.capture('Discard pressed, then confirmed', () => drive.evaluate(`(async () => {
    const press = () => [...((${row})?.querySelectorAll('.lc-routinechanges button') ?? [])].find((b) => /^Discard|Discard for good\\?$/.test(b.innerText.trim()))
    press()?.click()
    await new Promise((r) => setTimeout(r, 400))
    const armed = press()?.innerText.trim() ?? ''
    press()?.click()
    for (let i = 0; i < 20 && (${row})?.querySelector('.lc-routinechanges'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 600))
    return armed + ' | ' + (document.querySelector('.lc-claim')?.innerText.replace(/\\s+/g, ' ').trim() ?? '')
  })()`)))
  check('Discard asks first, then throws the change away; the folder still has no receipt.md', /^Discard for good\?/.test(discarded) && /Discarded\. Nothing from that run/.test(discarded) && !(await exists(RECEIPT)), discarded)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A routine for Cedar on ${MODEL}, Change files, in a copy; Run, Keep, Run, Discard.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
