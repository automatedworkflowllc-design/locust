// Routines on set days, or once (0.517).
//
//   node _tools/drive-routines-on-set-days.mjs [--packaged <exe>] [--tag <name>]
//
// From the product-ideas round four (2026-10-01): "every weekday at 9" and
// "next Tuesday at 3" had no shape; a routine ran every N hours or daily. The
// everyday profile, from the Routines screen: the schedule choices fit the
// dialog; "On set days" starts on Monday to Friday, a day can be turned off,
// and the row reads the days and the next one; edited to "Once", it starts
// tomorrow at 09:00 and the row reads it. At 1120 too. Sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('routines-on-set-days-2026-10-01'), tag)
await mkdir(OUT, { recursive: true })

const everyday = await seedEverydayLedger('routine-set-days')
const drive = await startDrive({
  name: `routines-on-set-days-${tag}`, port: 9834, workspace: everyday.workspace, profilePath: everyday.profilePath, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  sendsNothing: true,
  seed: everyday.seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const rows = `[...document.querySelectorAll('.lc-routinerow:not(.lc-routineadd)')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`
// Opens Save on the nth finished conversation the screen offers.
const openSave = (index) => `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  const row = document.querySelectorAll('.lc-savable__row')[${String(index)}]
  row?.querySelector('button.lc-button')?.click()
  await new Promise((r) => setTimeout(r, 800))
  return !!document.querySelector('.lc-dialog[aria-label="Save as routine"]')
})()`
// The schedule choices, and whether any spills past the dialog's edge.
// Edits the routine already saved: the second and third look go through it.
const openEdit = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  document.querySelector('.lc-routinerow:not(.lc-routineadd) [title="Edit routine"]')?.click()
  await new Promise((r) => setTimeout(r, 800))
  return !!document.querySelector('.lc-dialog[aria-label="Edit routine"]')
})()`
const choices = `(() => {
  const box = document.querySelector('.lc-dialog')
  const inner = box.getBoundingClientRect()
  const radios = [...box.querySelectorAll('[role=radio]')]
  return JSON.stringify({
    labels: radios.map((b) => b.innerText.trim()),
    spill: Math.max(0, ...radios.map((b) => Math.round(b.getBoundingClientRect().right - inner.right))),
    wrapped: new Set(radios.map((b) => Math.round(b.getBoundingClientRect().top))).size
  })
})()`
const pick = (label) => `(async () => {
  ;[...document.querySelectorAll('.lc-dialog [role=radio]')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})?.click()
  await new Promise((r) => setTimeout(r, 400))
})()`
const save = `(async () => {
  ;[...document.querySelectorAll('.lc-dialog button.lc-primarybutton')].pop()?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return JSON.stringify({ open: !!document.querySelector('.lc-dialog'), rows: ${rows} })
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  check('Save opens the dialog', await drive.evaluate(openSave(0)) === true)
  const seen = JSON.parse(String(await drive.capture('the schedule choices', () => drive.evaluate(choices))))
  check('five choices: Run, every few hours, daily, set days, once', JSON.stringify(seen.labels) === JSON.stringify(['Only when I press Run', 'Every few hours', 'Daily at a time', 'On set days', 'Once']), JSON.stringify(seen.labels))
  check('they fit the dialog, on one line', seen.spill <= 0 && seen.wrapped === 1, JSON.stringify(seen))

  await drive.evaluate(pick('On set days'))
  const days = JSON.parse(String(await drive.capture('On set days: Monday to Friday to begin with', () => drive.evaluate(`JSON.stringify({
    days: [...document.querySelectorAll('.lc-dialog [aria-label="Days it runs"] button')].map((b) => b.innerText.trim() + (b.getAttribute('aria-pressed') === 'true' ? '+' : '')),
    time: document.querySelector('.lc-dialog input[aria-label="Time of day"]')?.value ?? ''
  })`))))
  check('it starts on Monday to Friday at 09:00', days.days.join(' ') === 'Mon+ Tue+ Wed+ Thu+ Fri+ Sat Sun' && days.time === '09:00', JSON.stringify(days))
  await drive.evaluate(`[...document.querySelectorAll('.lc-dialog [aria-label="Days it runs"] button')].find((b) => b.innerText.trim() === 'Fri')?.click()`)
  const weekly = JSON.parse(String(await drive.capture('Friday off, saved', () => drive.evaluate(save))))
  check('saved, the row reads the days and the next one', !weekly.open && weekly.rows.some((row) => /Mon, Tue, Wed, Thu at 09:00 · next/.test(row)), JSON.stringify(weekly.rows))

  check('Edit opens it again, on set days', await drive.evaluate(openEdit) === true)
  await drive.evaluate(pick('Once'))
  const once = JSON.parse(String(await drive.capture('Once: tomorrow at 09:00 to begin with', () => drive.evaluate(`JSON.stringify({
    on: document.querySelector('.lc-dialog input[aria-label="Date and time"]')?.value ?? '',
    passed: /has passed/.test(document.querySelector('.lc-dialog')?.innerText ?? '')
  })`))))
  const tomorrow = new Date(Date.now() + 24 * 3_600_000)
  const two = (value) => String(value).padStart(2, '0')
  const expected = `${String(tomorrow.getFullYear())}-${two(tomorrow.getMonth() + 1)}-${two(tomorrow.getDate())}T09:00`
  check('it starts tomorrow at 09:00, with no "has passed" note', once.on === expected && !once.passed, JSON.stringify(once))
  const onceSaved = JSON.parse(String(await drive.capture('Once, saved', () => drive.evaluate(save))))
  check('saved, the row reads once, the day, and next tomorrow', !onceSaved.open && onceSaved.rows.some((row) => /once, \w{3} \w{3} \d{1,2} at 09:00 · next tomorrow 09:00/.test(row)), JSON.stringify(onceSaved.rows))

  await drive.resize(1120, 760)
  await sleep(1200)
  check('Edit opens at 1120', await drive.evaluate(openEdit) === true)
  await drive.evaluate(pick('On set days'))
  const narrow = JSON.parse(String(await drive.capture('1120: the choices and the days', () => drive.evaluate(choices))))
  const overflow = Number(await drive.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'))
  check('at 1120 they still fit, and nothing scrolls sideways', narrow.spill <= 0 && narrow.wrapped === 1 && overflow <= 0, JSON.stringify({ ...narrow, overflow }))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. The everyday profile; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
