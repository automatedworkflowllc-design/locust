// Fresh-eyes area 11: Routines, as a person meets them.
//
//   node _tools/drive-a-routine-from-scratch.mjs [--packaged <exe>] [--tag <name>]
//
// The everyday profile (everyday-ledger.mjs), its teammates on a free model
// in Ask. From the Routines screen with nothing saved: save one of the
// finished conversations it offers, read the dialog, save it daily, read the
// row, run it now, and read what the run left -- the row, the sidebar, the
// conversation. Then 1120. Free model; one run.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('a-routine-from-scratch-2026-09-28'), `a-routine-from-scratch-${tag}`)
await mkdir(OUT, { recursive: true })

const everyday = await seedEverydayLedger('routine-scratch')
const route = { ...FREE_ROUTE, mode: 'ask' }
const seed = { ...everyday.seed, teammates: everyday.seed.teammates.map((teammate) => ({ ...teammate, route })) }
const drive = await startDrive({
  name: `routine-scratch-${tag}`, port: 9747, workspace: everyday.workspace, profilePath: everyday.profilePath, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const screenText = `document.querySelector('.lc-automations')?.innerText.replace(/\\s+/g, ' ') ?? ''`
const rows = `JSON.stringify([...document.querySelectorAll('.lc-routinerow:not(.lc-routineadd)')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()))`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  const empty = String(await drive.capture('Routines, with nothing saved', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1000))
    return JSON.stringify({ text: ${screenText}, savable: [...document.querySelectorAll('.lc-savable__row')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()) })
  })()`)))
  const first = JSON.parse(empty)
  say(`  screen: ${first.text.slice(0, 400)}`)
  for (const row of first.savable) say(`    savable: ${row}`)
  check('with nothing saved, it offers finished conversations to save', first.savable.length > 0, String(first.savable.length))

  const dialog = JSON.parse(String(await drive.capture('Save: the dialog', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-savable__row')].find((r) => /shift schedule/.test(r.innerText)) ?? document.querySelector('.lc-savable__row')
    row?.querySelector('button.lc-button')?.click()
    await new Promise((r) => setTimeout(r, 800))
    const box = document.querySelector('.lc-dialog[aria-label="Save as routine"]')
    return JSON.stringify({
      open: !!box,
      name: box?.querySelector('#routine-name')?.value ?? '',
      runner: box?.querySelector('#routine-runner')?.selectedOptions?.[0]?.innerText ?? '(none)',
      steps: [...(box?.querySelectorAll('.lc-routinestep__text') ?? [])].map((s) => s.value),
      schedules: [...(box?.querySelectorAll('[role=radio]') ?? [])].map((b) => b.innerText.trim() + (b.getAttribute('aria-checked') === 'true' ? ' (on)' : '')),
      text: box?.innerText.replace(/\\s+/g, ' ') ?? ''
    })
  })()`))))
  say(`  dialog: ${JSON.stringify(dialog).slice(0, 700)}`)
  check('Save opens the dialog, named and with its steps filled in', dialog.open && dialog.name.length > 0 && dialog.steps.length > 0, JSON.stringify({ name: dialog.name, steps: dialog.steps }))
  check('it says Marlow runs it, on the model in plain words', /Marlow runs it on OpenCode \/ Nemotron 3 Ultra Free\./.test(dialog.text), dialog.text.slice(0, 160))

  const saved = JSON.parse(String(await drive.capture('saved, daily', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-dialog[aria-label="Save as routine"]')
    const daily = [...box.querySelectorAll('[role=radio]')].find((b) => /^Daily/.test(b.innerText.trim()))
    daily?.click()
    await new Promise((r) => setTimeout(r, 500))
    const chosen = [...document.querySelectorAll('.lc-dialog [role=radio]')].map((b) => b.innerText.trim() + '=' + b.getAttribute('aria-checked')).join(', ')
    const time = document.querySelector('.lc-dialog input[aria-label="Time of day"]')?.value ?? '(no time field)'
    const save = [...document.querySelectorAll('.lc-dialog button.lc-primarybutton')].pop()
    const said = save?.innerText ?? ''
    save?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({ found: !!daily, chosen, time, said, dialog: !!document.querySelector('.lc-dialog'), rows: JSON.parse(${rows}), text: ${screenText} })
  })()`))))
  say(`  saved: ${JSON.stringify(saved).slice(0, 600)}`)
  check('saving closes the dialog and lists the routine', !saved.dialog && saved.rows.length === 1, JSON.stringify(saved.rows))
  check('Daily was chosen, and the row says it runs daily', /Daily at a time=true/.test(saved.chosen) && /daily|09:00/i.test(saved.rows[0] ?? ''), `${saved.chosen} || ${saved.time} || ${saved.rows[0]}`)

  const ran = JSON.parse(String(await drive.capture('Run now: started', () => drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-routinerow:not(.lc-routineadd)')
    const run = [...row.querySelectorAll('button')].find((b) => /run/i.test(b.innerText || b.getAttribute('aria-label') || ''))
    const said = run?.innerText || run?.getAttribute('aria-label') || '(no run button)'
    run?.click()
    await new Promise((r) => setTimeout(r, 2500))
    return JSON.stringify({ said, thread: !!document.querySelector('.lc-thread'), sidebar: [...document.querySelectorAll('.lc-convrow')].slice(0, 2).map((r) => r.innerText.replace(/\\s+/g, ' ').trim()) })
  })()`))))
  say(`  run now: ${JSON.stringify(ran).slice(0, 600)}`)
  check('Run opens the run as it happens', !/no run button/.test(ran.said) && ran.thread && /step 1 of 1/.test(ran.sidebar[0] ?? ''), JSON.stringify(ran))
  // It opened on the run; wait for the run, where a person watching would.
  for (let waited = 0; waited < 240_000; waited += 3000) {
    await sleep(3000)
    const lead = String(await drive.evaluate(`document.querySelector('.lc-convrow')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
    if (!/step \d of \d/.test(lead) && !document_running(lead)) break
  }
  await sleep(2500)
  const opened = String(await drive.capture('the run, finished', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(0, 800) ?? ''`)))
  say(`  run conversation: ${opened}`)
  check('the run replayed the saved step and was answered', /shift schedule/i.test(opened) && !/Working…/.test(opened) && opened.length > 120, opened.slice(0, 200))

  const done = JSON.parse(String(await drive.capture('Routines, after the run', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1000))
    return JSON.stringify({ rows: JSON.parse(${rows}), text: ${screenText} })
  })()`))))
  say(`  finished: ${JSON.stringify(done).slice(0, 700)}`)
  check('the row says it ran, and when it runs next', /run 1 time/.test(done.rows[0] ?? '') && /daily|09:00|next/i.test(done.rows[0] ?? ''), done.rows[0])

  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()`)
  await drive.resize(1120, 760)
  await sleep(1500)
  const narrow = JSON.parse(String(await drive.capture('Routines, 1120', () => drive.evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, rows: JSON.parse(${rows}) })`))))
  check('at 1120 nothing scrolls sideways', narrow.overflow <= 0, JSON.stringify(narrow))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. The everyday profile, teammates on ${route.model}, Ask.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

function document_running(line) {
  return /running|working/i.test(line)
}
