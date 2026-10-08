// A teammate's own instructions, typed in its Edit dialog, reach its turns (0.706).
//
//   LOCUST_SPEND=1 node _tools/drive-a-teammate-follows-its-instructions.mjs [--packaged <exe>] [--tag <name>]
//
// From the Paperclip scrub ("agents keep their own files"). Team > Wren's Edit:
// the Instructions box is typed into and saved. After a RESTART the box still
// holds them (the teammates file too), and a turn sent to Wren on the free
// model answers with the word they ask for -- the brief carried them. Then
// the box is emptied and saved, and the file has none. Spends nothing (free).
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const workspace = await scratchRepository('locust-drive-instr-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-instr-profile-'))
const outPath = join(recordRoot('a-teammate-follows-its-instructions-2026-10-08'), tag)
const SAID = 'End every reply with the exact word MAPLE, in capitals, on its own line.'
const options = (extra) => ({ name: `teammate-instructions-${tag}`, port: 9905, workspace, profilePath: profile, spends: true, outPath,
  ...(packaged === undefined ? {} : { packaged }), ...extra })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const OPEN_EDIT = `(async () => {
  ;[...document.querySelectorAll('button')].find((b) => /^\\s*Team\\s*$/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1200))
  document.querySelector('.lc-rostercard__edit')?.click()
  await new Promise((r) => setTimeout(r, 900))
  // Into view, so the frame shows the box and its hint, not the faces above it.
  document.querySelector('[aria-label="Instructions for this teammate"]')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  return document.querySelector('[aria-label="Instructions for this teammate"]')?.value ?? 'NO BOX'
})()`
const type = (text) => `(async () => {
  const box = document.querySelector('[aria-label="Instructions for this teammate"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  document.querySelector('.lc-dialog__foot .lc-primarybutton')?.click()
  await new Promise((r) => setTimeout(r, 1500))
  return document.querySelector('[role=dialog][aria-label="Edit teammate"]') === null ? 'saved' : 'STILL OPEN'
})()`
const savedWren = async () => JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8')).teammates.find((t) => t.teammateId === 'tm_wren')

let drive = await startDrive(options({
  keep: true,
  seed: { schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-08T00:00:00Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
}))
try {
  await drive.ready()
  await drive.resize(1215, 800)
  const empty = await drive.capture("Wren's Edit dialog, no instructions yet", () => drive.evaluate(OPEN_EDIT))
  check('the Edit dialog offers an empty Instructions box', empty === '', empty)
  check('saving closes the dialog', (await drive.evaluate(type(SAID))) === 'saved')
  check('the teammates file holds them', (await savedWren())?.instructions === SAID, JSON.stringify((await savedWren())?.instructions))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Instructions typed into Wren's Edit dialog.` })
}

try {
  drive = await startDrive(options({ stepFrom: 100, keep: false }))
  await drive.ready()
  await drive.resize(1215, 800)
  const kept = await drive.capture('after a restart, the box', () => drive.evaluate(OPEN_EDIT))
  check('after a restart the box still holds them', kept === SAID, kept)
  await drive.evaluate(`document.querySelector('.lc-dialog__foot .lc-ghostbutton')?.click()`)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 900)) })()`)
  await drive.capture('a turn to Wren on the free model', () => drive.evaluate(sendAndWaitScript('In one short sentence, say what a teammate is.', { waitSeconds: 240 })))
  const reply = await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '')`)
  const answer = reply.split(/In one short sentence, say what a teammate is\./).pop() ?? ''
  check('the reply ends with the word its instructions ask for', /MAPLE\s*$/m.test(answer), answer.replace(/\s+/g, ' ').slice(-200))
  await drive.evaluate(OPEN_EDIT)
  check('emptied and saved, the dialog closes', (await drive.evaluate(type(''))) === 'saved')
  check('the teammates file has none', (await savedWren())?.instructions === undefined, JSON.stringify((await savedWren())?.instructions))
  const errors = drive.record.flatMap((step) => step.errors)
  check('no renderer errors were captured', errors.length === 0, errors.join(' | '))
} catch (error) {
  failures += 1
  say(`drive failed after the restart: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The same profile after a restart: the instructions kept, followed by a free-model turn, then cleared.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
