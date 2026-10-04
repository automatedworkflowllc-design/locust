// A routine written from nothing, on a new file, that only reads (0.530).
//
//   node _tools/drive-a-new-routine-only-reads.mjs [--packaged <exe>] [--tag <name>]
//
// Sol's 0.528 pass, as an office user: Routines had no way to write one (only
// "save a finished conversation", which imported every turn), and a file
// routine's dialog promised "changes nothing" while its Edit run wrote into
// the folder. Here: Routines > New routine, one step written, "On a new
// file" in inbox, "Only read" chosen over the teammate's Edit, saved. The step
// ASKS for a receipt file to be written -- so a run that truly only reads
// leaves the folder as it was. A free OpenCode teammate (Fledge Alpha):
// spends nothing.

import { execFileSync } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const MODEL = process.env.LOCUST_FREE_MODEL ?? 'opencode/fledge-alpha-free'
const workspace = await scratchRepository('locust-drive-new-routine-ws-')
await mkdir(join(workspace, 'inbox'), { recursive: true })
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `new-routine-${tag}`,
  port: 9853,
  workspace,
  outPath: join(recordRoot('a-new-routine-only-reads-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    // In Edit: "Only read" has to be chosen, not inherited.
    teammates: [{ teammateId: 'tm_cedar', name: 'Cedar', hue: 'lime', role: 'Custom', roleTitle: 'Office', createdAt: '2026-10-01T05:00:00.000Z', route: { runtime: 'opencode', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const STEP = 'Read the new file in inbox. Write a receipt for it at receipts/<its name>.md holding its first line, then reply with that first line and the words RECEIPT DONE.'
const DIALOG = `document.querySelector('[role=dialog]')`
const text = (selector) => `(${selector})?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`
try {
  await drive.ready()
  await drive.resize(1209, 770)
  const opened = String(await drive.capture('Routines > New routine', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const button = [...document.querySelectorAll('.lc-screen__actions button')].find((b) => b.innerText.trim() === 'New routine')
    if (!button) return 'no New routine button'
    button.click()
    await new Promise((r) => setTimeout(r, 800))
    return (${DIALOG})?.getAttribute('aria-label') ?? 'no dialog'
  })()`)))
  check('Routines offers New routine, and it opens a dialog titled New routine', opened === 'New routine', opened)
  const filled = String(await drive.capture('one step written, on a new file in inbox', () => drive.evaluate(`(async () => {
    const dialog = ${DIALOG}
    const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    const name = dialog.querySelector('#routine-name')
    input.call(name, 'Inbox receipt'); name.dispatchEvent(new Event('input', { bubbles: true }))
    const step = dialog.querySelector('textarea[aria-label="Step 1"]')
    area.call(step, ${JSON.stringify(STEP)}); step.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    ;[...dialog.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'On a new file')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return ${text('document.querySelector("[role=dialog]")')}
  })()`)))
  check('the teammate is in Edit, so "Change files" is what it starts on, and the trigger says so', /What a run may do Only read Change files/i.test(filled) && /It may change files, and what it changes lands in the folder straight away\./.test(filled) && !/as every routine runs in Ask/.test(filled), filled)
  const chosen = String(await drive.capture('"Only read" chosen', () => drive.evaluate(`(async () => {
    const dialog = ${DIALOG}
    ;[...dialog.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'Only read')?.click()
    await new Promise((r) => setTimeout(r, 400))
    return ${text('document.querySelector("[role=dialog]")')}
  })()`)))
  check('chosen, every sentence says it only reads, and the top line says Ask', /in Ask\./.test(chosen) && /always Ask\./.test(chosen) && /It reads the file and changes nothing\./.test(chosen) && /nothing in the folder changes/.test(chosen), chosen)
  const saved = String(await drive.capture('saved: the routine row', () => drive.evaluate(`(async () => {
    ;[...(${DIALOG})?.querySelectorAll('button') ?? []].find((b) => b.innerText.trim() === 'Save routine')?.click()
    for (let i = 0; i < 20 && ${DIALOG}; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 800))
    return ${text('document.querySelector(".lc-routinerow:not(.lc-routineadd)")')}
  })()`)))
  check('saved, the row says it watches inbox', /when a new file arrives in inbox · watching/.test(saved), saved)
  // The watcher's first look settles what is there; then a file lands.
  await sleep(25_000)
  await writeFile(join(workspace, 'inbox', 'note-7.txt'), 'Order 7 shipped Tuesday.\nSecond line.\n', 'utf8')
  say('  dropped inbox/note-7.txt')
  let thread = ''
  for (let waited = 0; waited < 240_000; waited += 5_000) {
    await sleep(5_000)
    thread = String(await drive.evaluate(`(async () => {
      const row = [...document.querySelectorAll('.lc-convrow button.lc-conv')][0]
      if (!row) return ''
      row.click()
      await new Promise((r) => setTimeout(r, 800))
      return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    })()`))
    if (/Routine "Inbox receipt" finished/.test(thread) || /Routine "Inbox receipt" (stopped|failed)/.test(thread)) break
  }
  await drive.capture('the run the file started', () => drive.evaluate('1'))
  check('the new file started the routine, and the run says why', /Started because a new file arrived: inbox\/note-7\.txt\./.test(thread), thread.slice(0, 400))
  const receipts = await readdir(join(workspace, 'receipts')).catch(() => [])
  check('it only read: no receipt was written into the folder', receipts.length === 0, JSON.stringify(receipts))
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' }).trim()
  check('git sees only the dropped file', status === '?? inbox/', status)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. New routine for Cedar on ${MODEL} (Edit), "Only read", on a new file in inbox.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
