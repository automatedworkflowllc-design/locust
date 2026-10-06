// A folder too big to copy: Compare says what Auto will do there, before anything is sent (0.457, 0.675).
//
//   node _tools/drive-compare-big-folder.mjs [--packaged <exe>]
//
// Colin, 2026-09-29: Compare in Auto, in his `.claude` (a plain folder, far
// more than 5,000 files). Both columns came back "could not start: this folder
// is too big to copy". 0.457 greyed Auto out there; 0.555 let it work in the
// folder itself instead -- while Auto's line went on promising each model a copy
// of its own (2026-10-06 sweep). This opens Compare in a plain folder one file
// past the copy limit and reads the menu: Auto is offered, says the models work
// in the folder itself, and the chip starts on Ask. Sends nothing.

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
  // As the window a person is using: a drive's window never has focus, and unfocused, Compare models sometimes did not
  // turn Compare on at all (2026-10-06: about half the runs read the ordinary mode menu; focused, ten of ten did).
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await drive.send('Page.bringToFront')
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
    // Compare models starts with recent models already ticked (prefills): tick more only up to two. Clicking the
    // first two rows regardless unticked a prefilled one, and the comparison fell to one model and switched off
    // (2026-10-06: half the runs read the ordinary mode menu).
    for (const row of [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].filter((row) => !row.disabled && row.getAttribute('aria-pressed') !== 'true')) {
      if (document.querySelectorAll('.lc-picker__row[aria-pressed="true"]').length >= 2) break
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
  check('Auto is offered, and says the models work in the folder itself, not a copy', menu.autoDisabled === false && /too big to copy, so each model works in the folder itself/.test(menu.autoSays) && !/its own copy/.test(menu.autoSays), JSON.stringify(menu))
  check('the comparison is on Ask, not Auto', menu.label === 'Ask', menu.label)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A plain folder of 5,001 files; Auto on in Settings.`, extra: `Checks failed: ${String(failures)}` })
}
