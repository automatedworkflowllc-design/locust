// A new routine for a teammate that has never had a conversation (0.535).
//
//   node _tools/drive-a-fresh-teammates-routine.mjs [--packaged <exe>] [--tag <name>]
//
// Sol's 0.532 recheck: for a brand-new teammate (no route yet), New routine
// hid "What a run may do" and promised changes "land straight away", while
// saving fell back to Ask. Here: a teammate with no route, Routines > New
// routine, the choice is there, "Only read" is chosen, and the stored
// routine runs in Ask. Nothing runs: spends nothing.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-fresh-routine-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `fresh-routine-${tag}`,
  port: 9857,
  workspace,
  outPath: join(recordRoot('a-fresh-teammates-routine-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    // No route: this teammate has never run.
    teammates: [{ teammateId: 'tm_birch', name: 'Birch', hue: 'lime', role: 'Custom', roleTitle: 'Office', createdAt: '2026-10-01T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
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
    return ${text(DIALOG)}
  })()`)))
  check('a teammate that never ran still gets "What a run may do"', /What a run may do Only read Change files/i.test(opened), opened)
  check('and is told which model a run uses until it has worked on one', /Each run uses the model Birch last worked on \(this one, until they have worked on one\)/.test(opened), opened)
  const chosen = String(await drive.capture('"Only read" chosen', () => drive.evaluate(`(async () => {
    const dialog = ${DIALOG}
    const input = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const area = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    const name = dialog.querySelector('#routine-name')
    input.call(name, 'Morning read'); name.dispatchEvent(new Event('input', { bubbles: true }))
    const step = dialog.querySelector('textarea[aria-label="Step 1"]')
    area.call(step, 'Read README.md and say what it is for.'); step.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    ;[...dialog.querySelectorAll('[role=radio]')].find((b) => b.innerText.trim() === 'Only read')?.click()
    await new Promise((r) => setTimeout(r, 400))
    return ${text(DIALOG)}
  })()`)))
  check('chosen, the dialog says Ask', /in Ask\./.test(chosen), chosen)
  const stored = await drive.evaluate(`(async () => {
    ;[...(${DIALOG})?.querySelectorAll('button') ?? []].find((b) => b.innerText.trim() === 'Save routine')?.click()
    for (let i = 0; i < 20 && ${DIALOG}; i += 1) await new Promise((r) => setTimeout(r, 250))
    const listed = await window.desktop.listRoutines()
    return JSON.stringify(listed.ok ? listed.data.routines.map((r) => ({ name: r.name, teammateId: r.teammateId, route: r.route })) : listed)
  })()`)
  await drive.capture('saved', () => drive.evaluate('1'))
  const routines = JSON.parse(String(stored))
  check('saved for Birch, in Ask, as the dialog said', Array.isArray(routines) && routines.length === 1 && routines[0].teammateId === 'tm_birch' && routines[0].route?.mode === 'ask', stored)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. New routine for Birch, a teammate with no route yet; "Only read".`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
