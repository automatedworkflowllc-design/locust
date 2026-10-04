// Making teammates, the two ways a new person does (fresh-eyes check, area
// "Making a teammate").
//
//   node _tools/drive-make-a-teammate.mjs [--packaged <exe>] [--tag <name>]
//
// Sends nothing. A fresh profile with nobody on the team:
//   1. Home's "Build software" starter team: three teammates appear.
//   2. New teammate by hand (the sidebar's +), at 1440x900 and 1120x720:
//      the window fits, its parts are there, and Robin is made once.
//   3. The Team screen lists all four, and a teammate's own edit window opens.
// Every step is captured, to be looked at.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('make-a-teammate-2026-09-27'), `make-a-teammate-${tag}`)
await mkdir(OUT, { recursive: true })
const drive = await startDrive({
  name: `make-a-teammate-${tag}`, port: 9725, workspace: await scratchRepository('locust-make-teammate-ws-'), outPath: OUT,
  sendsNothing: true, ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const DIALOG = `JSON.stringify((() => {
  const dialog = document.querySelector('.lc-dialog')
  if (!dialog) return { open: false }
  const r = dialog.getBoundingClientRect()
  const create = [...dialog.querySelectorAll('button')].find((b) => /^Create teammate$/.test(b.textContent.trim()))
  const c = create?.getBoundingClientRect()
  return {
    open: true, top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight,
    createBottom: c ? Math.round(c.bottom) : -1,
    labels: [...dialog.querySelectorAll('label, legend, h2, h3')].map((l) => l.textContent.trim().replace(/\\s+/g, ' ')).filter(Boolean).slice(0, 12)
  }
})())`
const roster = () => drive.evaluate(`(async () => {
  // The sidebar's own Team button (as drive-team-card opens it); a search for a
  // button reading "Team" missed one run in two.
  document.querySelector('.lc-faces__team')?.click()
  for (let i = 0; i < 30 && document.querySelectorAll('.lc-rostercard__name').length === 0; i += 1) await new Promise((r) => setTimeout(r, 150))
  return JSON.stringify([...document.querySelectorAll('.lc-rostercard__name')].map((n) => n.textContent.trim()))
})()`)

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1200)
  // 1. A starter team from Home.
  const used = String(await drive.capture('Home: the Build software starter team, used', () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-empty button, .lc-empty [role=button]')].find((b) => /Build software/.test(b.textContent ?? ''))
    if (!card) return 'no Build software card'
    card.click()
    await new Promise((r) => setTimeout(r, 1500))
    return document.querySelector('.lc-hometeam')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no team section'
  })()`)))
  check('the starter team puts Wren, Juno and Atlas on Home', /Wren/.test(used) && /Juno/.test(used) && /Atlas/.test(used), used.slice(0, 160))
  // 2. New teammate by hand, at two sizes.
  for (const [width, height] of [[1440, 900], [1120, 720]]) {
    await drive.resize(width, height)
    await sleep(700)
    await drive.evaluate(`(async () => {
      document.querySelector('.lc-sidebar button[aria-label="Add"]')?.click()
      await new Promise((r) => setTimeout(r, 500))
      ;[...document.querySelectorAll('.lc-context__item')].find((b) => /^New teammate/.test(b.textContent.trim()))?.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    const seen = JSON.parse(String(await drive.capture(`New teammate at ${String(width)}x${String(height)}`, () => drive.evaluate(DIALOG))))
    check(`${String(width)}x${String(height)}: the New teammate window opens and fits, Create on screen`, seen.open && seen.top >= 38 && seen.createBottom > 0 && seen.createBottom <= seen.height, JSON.stringify(seen))
    if (width === 1120) break
    await drive.evaluate(`(() => { const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); document.activeElement?.dispatchEvent(esc); document.dispatchEvent(esc) })()`)
    await sleep(500)
  }
  // 0.408: the box's hint is a name not already on the team -- Wren is taken.
  const hint = String(await drive.evaluate(`document.querySelector('#lc-teammate-name')?.getAttribute('placeholder') ?? ''`))
  check('the name box suggests a free name, not Wren', hint === 'Robin', hint)
  const made = String(await drive.capture('Robin, named and created', () => drive.evaluate(`(async () => {
    const field = document.querySelector('#lc-teammate-name')
    if (!field) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(field, 'Robin')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    const create = [...document.querySelectorAll('.lc-dialog button')].find((b) => /^Create teammate$/.test(b.textContent.trim()))
    if (!create || create.disabled) return 'Create not pressable'
    create.click()
    await new Promise((r) => setTimeout(r, 1800))
    return document.querySelector('.lc-dialog') ? 'dialog still open: ' + document.querySelector('.lc-dialog').innerText.replace(/\\s+/g, ' ').slice(0, 160) : 'created'
  })()`)))
  check('Robin is created and the window closes', made === 'created', made)
  // 3. The Team screen, and a teammate's own edit window.
  await drive.resize(1440, 900)
  // Back from 1120, where the sidebar is the compact rail: wait for the full
  // sidebar (and its Team button) before pressing it.
  for (let i = 0; i < 30 && String(await drive.evaluate(`String(document.querySelector('.lc-faces__team') !== null)`)) !== 'true'; i += 1) await sleep(200)
  const names = JSON.parse(String(await drive.capture('the Team screen', () => roster())))
  check('the Team screen lists all four, Robin once', ['Wren', 'Juno', 'Atlas', 'Robin'].every((n) => names.includes(n)) && names.filter((n) => n === 'Robin').length === 1, JSON.stringify(names))
  const edit = String(await drive.capture('Robin’s edit window', () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-rostercard')].find((c) => /Robin/.test(c.innerText))
    const button = card && [...card.querySelectorAll('button')].find((b) => /Edit/.test(b.textContent ?? '') || /Edit/.test(b.getAttribute('aria-label') ?? ''))
    ;(button ?? card)?.click()
    await new Promise((r) => setTimeout(r, 900))
    const dialog = document.querySelector('.lc-dialog')
    if (!dialog) return 'no dialog'
    // The name is the value of its field, not text.
    return dialog.innerText.replace(/\\s+/g, ' ').slice(0, 40) + ' | ' + [...dialog.querySelectorAll('input')].map((i) => i.value).filter(Boolean).join(', ')
  })()`)))
  check('a teammate’s edit window opens with its name', /Edit teammate/.test(edit) && /Robin/.test(edit), edit.slice(0, 160))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A fresh profile, nobody on the team.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
