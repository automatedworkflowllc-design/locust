// About you takes a person and refuses a key (0.433).
//
//   node _tools/drive-about-you-keeps-keys-out.mjs [--packaged <exe>] [--tag <name>]
//
// Spends nothing: no run at all.
//
// Colin, 2026-09-28: "honestly agents keep personal details about the user
// to help understand them, i dont see why its an issue ... maybe just
// passwords and api keys/stuff like that." On the Memory screen, About you
// is saved with personal details (a place, family, an email, a phone); then
// a note holding a made-up API key is tried. The key must be refused, in
// words and in amber, and after a relaunch the note must still be the
// personal one.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('about-you-keeps-keys-out-2026-09-28'), `about-you-keeps-keys-out-${tag}`)
await mkdir(OUT, { recursive: true })

const PERSON = 'I live in [removed] with my daughter Emma. Reach me at colin@example.com or 352-555-0142. Keep answers short.'
// Made up, in the shape of an OpenAI project key.
const KEYED = 'Use my key sk-proj-EXAMPLEexampleEXAMPLEexample0123 for the billing API.'

const seed = { schemaVersion: 1, teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto', autoMode: false } }
const workspace = await scratchRepository('locust-drive-about-you-keys-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const note = (text) => `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  const box = document.querySelector('textarea[aria-label="About you"]')
  if (!box) return JSON.stringify({ card: false })
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  ;[...box.closest('section').querySelectorAll('button.lc-primarybutton')].pop()?.click()
  await new Promise((r) => setTimeout(r, 900))
  const status = box.closest('section').querySelector('[role=status]')
  return JSON.stringify({ card: true, status: status?.innerText ?? '', amber: status?.classList.contains('lc-tone-amber') === true })
})()`
const saved = `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
  for (let i = 0; i < 20 && !document.querySelector('textarea[aria-label="About you"]'); i += 1) await new Promise((r) => setTimeout(r, 300))
  await new Promise((r) => setTimeout(r, 600))
  return document.querySelector('textarea[aria-label="About you"]')?.value ?? '(no card)'
})()`

let drive = await startDrive({ name: `about-you-keys-${tag}`, port: 9769, workspace, outPath: OUT, keep: true, seed, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const person = JSON.parse(String(await drive.capture('About you: personal details', () => drive.evaluate(note(PERSON)))))
  check('personal details are saved', person.card && /^Saved/.test(person.status) && !person.amber, JSON.stringify(person))
  const keyed = JSON.parse(String(await drive.capture('About you: a key', () => drive.evaluate(note(KEYED)))))
  check('a key is refused, in words that say why, in amber', /OpenAI API key/.test(keyed.status) && /not saved/.test(keyed.status) && keyed.amber, JSON.stringify(keyed))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No run. About you saved with personal details, then tried with a made-up key; then relaunched.`, extra: `Checks failed (first launch): ${String(failures)}` })
}
// Relaunched on the same profile: the note on disk is still the person's.
await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `about-you-keys-${tag}-again`, port: 9769, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 2, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await sleep(1500)
  const after = String(await drive.capture('After a relaunch', () => drive.evaluate(saved)))
  check('after a relaunch, About you is still the personal note, and no key was ever kept', after === PERSON, after)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
