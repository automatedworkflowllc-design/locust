// Compare, for someone with no teammates (0.442).
//
//   node _tools/drive-compare-from-home.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only (OpenCode's free tier): spends nothing.
//
// Colin, 2026-09-28: "shouldnt compare mode be implemented in regular chats as
// well? You dont NEED a teammate assigned to complete the task and want new
// users to be able to try that out". A profile with NO teammates: Home's AI
// agents line offers Compare models; it opens the picker already on Compare;
// two free models ticked, one ask, both columns answer at once with nobody's
// name on them; Keep this one leaves an ordinary conversation of nobody's.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'nemotron-3-ultra-free,mimo-v2.6-flash-free').split(',')
const OUT = join(recordRoot('compare-from-home-2026-09-28'), `compare-from-home-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-compare-home-ws-')
const drive = await startDrive({
  name: `compare-from-home-${tag}`, port: 9777, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(4000)

  const opened = JSON.parse(String(await drive.capture('Home: Compare models opens the picker on Compare', () => drive.evaluate(`(async () => {
    let button
    for (let i = 0; i < 40 && !button; i += 1) {
      button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Compare models')
      if (!button) await new Promise((r) => setTimeout(r, 500))
    }
    if (!button) return JSON.stringify({ button: false })
    button.click()
    await new Promise((r) => setTimeout(r, 900))
    const on = [...document.querySelectorAll('.lc-picker__mode')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent.trim() ?? ''
    const box = document.querySelector('.lc-picker__input')
    if (box) {
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, 'free')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
    }
    const labels = []
    for (const want of ${JSON.stringify(PICKS)}) {
      const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && one.querySelector('.lc-picker__label')?.textContent.trim() === want)
      if (!row) continue
      row.click()
      labels.push(want)
      await new Promise((r) => setTimeout(r, 250))
    }
    return JSON.stringify({ button: true, picker: document.querySelector('.lc-picker') !== null, on, labels })
  })()`))))
  say(`  opened: ${JSON.stringify(opened)}`)
  check('Home offers Compare models, with no teammate at all', opened.button === true, JSON.stringify(opened))
  check('it opens the picker already on Compare', opened.picker && opened.on === 'Compare', JSON.stringify(opened))
  check('two free models tick', opened.labels?.length === 2, JSON.stringify(opened.labels))

  const answered = JSON.parse(String(await drive.capture('Both columns answer, nobody\'s', () => drive.evaluate(`(async () => {
    [...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')?.click()
    await new Promise((r) => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'In one sentence: what is a pull request?')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Start mission"]')?.click()
    let bothRan = false
    for (let i = 0; i < 1200; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const states = [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
      if (states.length === 2 && states.every((state) => state === 'working')) bothRan = true
      if (i > 6 && states.length === 2 && states.every((state) => state !== 'working' && state !== 'waiting')) break
    }
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({
      open: document.querySelector('.lc-compare') !== null,
      bothRan,
      heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
      cells: [...document.querySelectorAll('.lc-compare__cell')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim().length),
      rows: document.querySelectorAll('.lc-conv').length,
      vsRows: [...document.querySelectorAll('.lc-conv')].filter((row) => row.querySelector('.lc-conv__vs')).length
    })
  })()`))))
  say(`  answered: ${JSON.stringify(answered)}`)
  check('the comparison opens with two columns, both done', answered.open && answered.heads.length === 2 && answered.heads.every((head) => / done$/.test(head)), JSON.stringify(answered.heads))
  check('both columns ran at once, with nobody\'s name on them', answered.bothRan === true, JSON.stringify(answered))
  check('both answered', answered.cells.length === 2 && answered.cells.every((length) => length > 20), JSON.stringify(answered.cells))
  check('the sidebar lists it once, marked vs', answered.rows === 1 && answered.vsRows === 1, JSON.stringify(answered))

  const kept = JSON.parse(String(await drive.capture('Kept: an ordinary conversation of nobody\'s', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
    for (let i = 0; i < 40 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({
      gone: document.querySelector('.lc-compare') === null,
      thread: (document.querySelector('.lc-thread')?.innerText ?? '').length,
      compared: document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      rows: document.querySelectorAll('.lc-conv').length
    })
  })()`))))
  say(`  kept: ${JSON.stringify(kept)}`)
  check('Keep this one leaves an ordinary conversation that says what it was compared with', kept.gone && kept.thread > 40 && /^Compared with .+\. Open the comparison$/.test(kept.compared) && kept.rows === 1, JSON.stringify(kept))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A profile with no teammates; two free OpenCode models compared from Home.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
