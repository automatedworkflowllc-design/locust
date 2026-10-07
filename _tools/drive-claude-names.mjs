// Do Claude's routes name the version they run -- in the picker and on the chip?
//
//   node _tools/drive-claude-names.mjs [--packaged <exe>]
//
// Colin, 2026-09-22: "can we have the model type listed for claude? right now
// it just shows opus latest model, fable latest model". Opens the picker
// searched to Claude Code, reads every Claude row's label and line, picks Opus
// and reads the composer chip, and photographs both. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('claude-names-2026-09-22'), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-claude-names-ws-')
const drive = await startDrive({
  name: 'claude-names',
  port: 9397,
  workspace,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

const shoot = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const chipText = `([...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.textContent ?? '').replace(/\\s+/g, ' ').trim()`

try {
  await drive.ready()
  // Claude's catalogue arrives with its probe; wait for its rows to exist.
  await drive.waitFor(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!document.querySelector('.lc-picker')) control?.click()
    await new Promise(r => setTimeout(r, 400))
    const box = document.querySelector('.lc-picker__input')
    if (!box) return false
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(box, 'claude')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    return [...document.querySelectorAll('.lc-picker__row')].some((row) => /Opus/.test(row.textContent))
  })()`, { timeoutMs: 45_000, everyMs: 1_500, what: 'Claude rows in the picker' })
  await sleep(500)
  const rows = JSON.parse(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-picker__row')].map((row) => ({
    label: row.querySelector('.lc-picker__label')?.textContent?.trim() ?? '',
    detail: row.querySelector('.lc-picker__detail')?.textContent?.trim() ?? '',
    hover: row.getAttribute('title') ?? ''
  })))`))
  say('Claude rows in the picker:')
  for (const row of rows) say(`   ${row.label.padEnd(18)} ${row.detail}`)
  await shoot('01-picker-claude.png')
  const labels = rows.map((row) => row.label)
  for (const expected of ['Fable 5.1', 'Opus 5.5', 'Sonnet 5', 'Haiku 4.5']) check(`the picker names ${expected}`, labels.includes(expected), labels.join(', '))
  check('no row is a bare family name', !labels.some((label) => /^(Fable|Opus|Sonnet|Haiku)$/.test(label)), labels.join(', '))

  await drive.evaluate(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')`)
  await sleep(400)
  say(await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'opus', row: '/opus/i' })))
  await sleep(600)
  const chip = await drive.evaluate(chipText)
  say(`the composer chip reads: "${chip}"`)
  check('the chip reads Claude / Opus 5.5', /Claude\s*\/\s*Opus 5\.5/.test(chip), chip)
  await shoot('02-chip-opus.png')

  // The older versions: folded under Claude's current rows, opened by a press.
  const fold = JSON.parse(await drive.evaluate(`(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!document.querySelector('.lc-picker')) control?.click()
    await new Promise(r => setTimeout(r, 500))
    const toggle = document.querySelector('.lc-picker__fold')
    if (!toggle) return JSON.stringify({ toggle: false })
    const before = { expanded: toggle.getAttribute('aria-expanded'), text: toggle.textContent.replace(/\\s+/g, ' ').trim(), older: [...document.querySelectorAll('.lc-picker__label')].filter((l) => /^(Opus 4|Sonnet 4|Fable 5$|Opus 5$)/.test(l.textContent)).length }
    toggle.click()
    await new Promise(r => setTimeout(r, 400))
    const labels = [...document.querySelectorAll('.lc-picker__label')].map((l) => l.textContent)
    return JSON.stringify({ toggle: true, before, after: { expanded: document.querySelector('.lc-picker__fold')?.getAttribute('aria-expanded'), labels } })
  })()`))
  say(`the fold: ${JSON.stringify(fold.before)} -> opened: ${JSON.stringify(fold.after?.labels?.filter((l) => /Opus 4|Sonnet 4|Fable 5$|Opus 5$/.test(l)))}`)
  // CHANGELOG 0.275.0: "Older Claude versions, folded away." The catalogue has gained
  // another older model since that entry's eight; the fold's live count is not a fixed fixture.
  const olderCount = Number(/Older versions\s*(\d+)/.exec(fold.before?.text ?? '')?.[1] ?? 0)
  check('older versions are folded, and the fold says how many', fold.toggle && fold.before.expanded === 'false' && fold.before.older === 0 && olderCount > 0, JSON.stringify(fold.before))
  check('opening it shows them in place', fold.after?.expanded === 'true' && ['Opus 5', 'Opus 4.8', 'Opus 4.7', 'Opus 4.6', 'Opus 4.5', 'Fable 5', 'Sonnet 4.6', 'Sonnet 4.5'].every((name) => fold.after.labels.includes(name)))
  await shoot('03-fold-open.png')
  const picked = await drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-picker__row')].find((r) => r.querySelector('.lc-picker__label')?.textContent === 'Opus 4.8')
    row?.click()
    await new Promise(r => setTimeout(r, 500))
    return ${chipText}
  })()`)
  say(`after picking Opus 4.8 the chip reads: "${picked}"`)
  check('a pinned version names itself on the chip', /Claude\s*\/\s*Opus 4\.8/.test(picked), picked)
  await shoot('04-chip-opus-4-8.png')
  say(failures === 0 ? '\nCLAUDE NAMES PASSED' : `\nCLAUDE NAMES: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Claude routes name their version.' })
}
