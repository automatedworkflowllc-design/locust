// A folder too big to copy: Compare says so before anything is sent (0.457).
//
//   node _tools/drive-compare-big-folder.mjs [--packaged <exe>]
//
// Colin, 2026-09-29: Compare in Auto, in his `.claude` (a plain folder, far
// more than 5,000 files). Both columns came back "could not start: this folder
// is too big to copy", each with a Try again that could only fail the same
// way. The Compare menu was drawn to grey Auto out with a reason; nothing gave
// it one. This opens Compare in a plain folder of 5,001 files, picks two free
// models and reads the menu: Auto must be unavailable, with the reason, and
// the chip on Ask. Sends nothing.

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { SCRATCH_ROOT } from './scratch-root.mjs'
import { say, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
// Under Documents, like every drive folder: never AppData (memory cursorignore-blinds-appdata).
await mkdir(join(SCRATCH_ROOT), { recursive: true })
const workspace = await mkdtemp(join(SCRATCH_ROOT, 'locust-drive-bigfolder-ws-'))
// One more file than the app copies (compare-copies.ts MAX_COPY_FILES, read from the source so the drive cannot fall
// behind it: it built 5,001 when the limit was raised to 20,000, and the folder fit).
const limitSource = await readFile(new URL('../apps/desktop/src/main/compare-copies.ts', import.meta.url), 'utf8')
const MAX_COPY_FILES = Number(/MAX_COPY_FILES = ([\d_]+)/.exec(limitSource)?.[1]?.replace(/_/g, '') ?? NaN)
if (!Number.isFinite(MAX_COPY_FILES)) throw new Error('MAX_COPY_FILES was not found in compare-copies.ts')
for (let index = 0; index <= MAX_COPY_FILES; index += 1) await writeFile(join(workspace, `note-${String(index)}.txt`), '', 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'compare-big-folder', port: 9655, workspace, sendsNothing: true, launchElsewhere: true,
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await new Promise((r) => setTimeout(r, 4000))
  const menu = JSON.parse(String(await drive.capture('Compare in a folder one file past the copy limit: the mode menu', () => drive.evaluate(`(async () => {
    let button
    for (let i = 0; i < 40 && !button; i += 1) {
      button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Compare models')
      if (!button) await new Promise((r) => setTimeout(r, 500))
    }
    if (!button) return JSON.stringify({ opened: false })
    button.click()
    await new Promise((r) => setTimeout(r, 900))
    const box = document.querySelector('.lc-picker__input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'free')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 700))
    for (const row of [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].filter((row) => !row.disabled).slice(0, 2)) {
      row.click()
      await new Promise((r) => setTimeout(r, 250))
    }
    ;[...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')?.click()
    // The folder is measured when Compare opens; give it the time a person's reach to the chip takes.
    await new Promise((r) => setTimeout(r, 1500))
    const chip = document.querySelector('button[aria-label="Permission mode"]')
    const label = chip?.textContent.trim() ?? ''
    chip?.click()
    await new Promise((r) => setTimeout(r, 500))
    const auto = [...document.querySelectorAll('.lc-menu[aria-label="What the comparison does"] .lc-menu__item')].find((item) => item.querySelector('.lc-menu__name')?.textContent.trim() === 'Auto')
    return JSON.stringify({ opened: true, label, autoDisabled: auto?.disabled ?? null, autoSays: auto?.querySelector('.lc-menu__desc')?.textContent ?? '' })
  })()`))))
  check('Auto is unavailable in a folder too big to copy, and says why', menu.autoDisabled === true && /too big to copy/.test(menu.autoSays), JSON.stringify(menu))
  check('the comparison is on Ask, not Auto', menu.label === 'Ask', menu.label)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A plain folder of 5,001 files; Auto on in Settings.`, extra: `Checks failed: ${String(failures)}` })
}
