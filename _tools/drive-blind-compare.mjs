// Blind compare and your own record (0.449).
//
//   node _tools/drive-blind-compare.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only (OpenCode's free tier): spends nothing.
//
// PLAN-2026-09-28-NEXT item 5, after Arena's Battle and leaderboard. Two free
// models ticked with "Hide the names" on: the columns read Model A and Model
// B, with no runtime, mark or cost, and the box asks "Model A vs Model B".
// Keep this one shows the names. Then the picker, on Compare again, shows each
// model's own record: kept 1 of 1, kept 0 of 1.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'nemotron-3-ultra-free,mimo-v2.6-flash-free').split(',')
const OUT = join(recordRoot('blind-compare-2026-09-28'), `blind-compare-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-blind-ws-')
const drive = await startDrive({
  focused: true,
  name: `blind-compare-${tag}`, port: 9784, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const OPEN_PICKER = `(async () => {
  let button
  for (let i = 0; i < 40 && !button; i += 1) {
    button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Compare models')
    if (!button) await new Promise((r) => setTimeout(r, 500))
  }
  button?.click()
  await new Promise((r) => setTimeout(r, 900))
  const box = document.querySelector('.lc-picker__input')
  const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setInput.call(box, 'free')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 700))
  return 'open'
})()`
const ROWS = `JSON.stringify(Object.fromEntries(${JSON.stringify(PICKS)}.map((want) => [want, [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => one.querySelector('.lc-picker__label')?.textContent.trim() === want)?.querySelector('.lc-picker__detail')?.textContent.trim() ?? ''])))`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(4000)
  await drive.evaluate(OPEN_PICKER)
  const picked = JSON.parse(String(await drive.capture('Two free models ticked, names hidden', () => drive.evaluate(`(async () => {
    const labels = []
    for (const want of ${JSON.stringify(PICKS)}) {
      const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && one.querySelector('.lc-picker__label')?.textContent.trim() === want)
      if (!row) continue
      row.click()
      labels.push(want)
      await new Promise((r) => setTimeout(r, 250))
    }
    // Blind is a chat mode (0.451): the chip, then Blind. The picks are kept.
    ;[...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')?.click()
    await new Promise((r) => setTimeout(r, 400))
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 400))
    ;[...document.querySelectorAll('.lc-menu[aria-label="Direct or compare"] .lc-menu__item')].find((item) => item.querySelector('.lc-menu__name')?.textContent.trim() === 'Blind')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const mode = document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? ''
    return JSON.stringify({ labels, blind: mode === 'Chat mode: Blind' ? 'true' : mode, chip: document.querySelector('.lc-control--chatmode')?.innerText.trim() ?? '' })
  })()`))))
  say(`  picked: ${JSON.stringify(picked)}`)
  check('two free models, and the chat mode chip on Blind', picked.labels.length === 2 && picked.blind === 'true', JSON.stringify(picked))

  const blind = JSON.parse(String(await drive.capture('Model A and Model B: nothing names them', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'In one sentence: what is a git branch?')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Send"]')?.click()
    for (let i = 0; i < 1200; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const states = [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
      if (i > 6 && states.length === 2 && states.every((state) => state !== 'working' && state !== 'waiting')) break
    }
    await new Promise((r) => setTimeout(r, 1200))
    const shell = [...document.querySelectorAll('.lc-compare__bar, .lc-compare__head, .lc-compare__foot')].map((el) => el.innerText).join(' | ')
    return JSON.stringify({
      heads: [...document.querySelectorAll('.lc-compare__head .lc-compare__name')].map((el) => el.textContent.trim()),
      marks: document.querySelectorAll('.lc-compare__head .lc-runtimemark, .lc-compare__head svg[class*="mark"], .lc-compare__runtime').length,
      shell: shell.replace(/\\s+/g, ' ').slice(0, 400),
      chip: [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    })
  })()`))))
  say(`  blind: ${JSON.stringify(blind)}`)
  check('the columns read Model A and Model B', blind.heads.join('|') === 'Model A|Model B', JSON.stringify(blind.heads))
  check('nothing on the columns names a model or runtime', blind.marks === 0 && !/OpenCode|Nemotron|Mimo|free/i.test(blind.shell) && /names hidden until you keep one/.test(blind.shell), JSON.stringify(blind))
  check('the box asks Model A vs Model B', /Model A vs Model B/.test(blind.chip), blind.chip)

  const revealed = JSON.parse(String(await drive.capture('Kept: the names show', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
    for (let i = 0; i < 60 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1000))
    const compared = document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    document.querySelector('.lc-compared__open')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return JSON.stringify({
      compared,
      heads: [...document.querySelectorAll('.lc-compare__head .lc-compare__name')].map((el) => el.textContent.trim()),
      bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    })
  })()`))))
  say(`  revealed: ${JSON.stringify(revealed)}`)
  const names = ['Nemotron 3 Ultra Free', 'Mimo V2.6 Flash Free']
  check('once kept, the conversation and the comparison name both models', /^Compared with (Nemotron 3 Ultra Free|Mimo V2\.6 Flash Free)\./.test(revealed.compared) && revealed.heads.length === 2 && revealed.heads.every((head) => names.includes(head)) && /^You kept (Nemotron 3 Ultra Free|Mimo V2\.6 Flash Free)/.test(revealed.bar), JSON.stringify(revealed))
  const keptName = /^You kept (.+?);/.exec(revealed.bar)?.[1]

  await drive.evaluate(`document.querySelector('.lc-compare__bar .lc-button')?.click()`)
  await sleep(800)
  await drive.evaluate(`document.querySelector('button.lc-brand__lockup')?.click()`)
  await sleep(2000)
  await drive.evaluate(OPEN_PICKER)
  const record = JSON.parse(String(await drive.capture('Compare again: each model shows its record', () => drive.evaluate(ROWS))))
  say(`  record: ${JSON.stringify(record)} kept=${String(keptName)}`)
  const labelOf = (name) => (name === 'Nemotron 3 Ultra Free' ? 'nemotron-3-ultra-free' : 'mimo-v2.6-flash-free')
  const other = names.find((name) => name !== keptName)
  check('the picker shows each model its record: the kept one 1 of 1, the other 0 of 1', keptName !== undefined && record[labelOf(keptName)] === 'kept 1 of 1' && record[labelOf(other)] === 'kept 0 of 1', JSON.stringify(record))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No teammates; two free OpenCode models compared blind, one kept, then the picker's record.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
