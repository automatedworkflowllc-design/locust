// Do Cursor's models read as names in the picker and on the chip?
//
//   node _tools/drive-cursor-names.mjs [--packaged <exe>] [--tag <name>]
//
// 2026-09-23: the picker listed twenty-six of Cursor's models by id --
// `claude-opus-5-5`, `cursor-grok-4.6`, `gpt-5.5` -- because a model Cursor
// lists only with an effort took its id as its name; `-max`, `-none` and
// `-minimal` were rows of their own, so "Kimi K3" appeared twice; and a
// mission on `claude-opus-5-5-medium` read "Claude Opus 5 5 Medium".
//
// Reads the Cursor rows this machine's own `cursor-agent` produces, through
// the picker's search, then picks two of them and reads the chip and the
// effort panel. Picking a route sends nothing; nothing is sent.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('beta-fixes-2026-09-23'), `cursor-names-${tag}`)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: `cursor-names-${tag}`,
  port: 9421,
  workspace: await scratchRepository('locust-drive-cursor-names-ws-'),
  sendsNothing: true,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

/** The Cursor rows the picker shows for a search, by their first line. */
const cursorRowsFor = (needle) => `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  if (!document.querySelector('.lc-picker')) control?.click()
  for (let i = 0; i < 40 && !document.querySelector('.lc-picker__input'); i += 1) await new Promise(r => setTimeout(r, 250))
  const box = document.querySelector('.lc-picker__input')
  if (!box) return JSON.stringify({ error: 'no picker' })
  const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setInput.call(box, ${JSON.stringify(needle)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 900))
  const rows = []
  let group = ''
  for (const node of document.querySelector('.lc-picker__list').children) {
    const header = node.querySelector('.lc-picker__group')
    if (header) group = header.innerText
    const row = node.querySelector('.lc-picker__row')
    if (row && /cursor/i.test(group)) rows.push(row.innerText.split(String.fromCharCode(10))[0].trim())
  }
  const more = [...document.querySelectorAll('.lc-picker__more')].map(p => p.innerText.trim())
  return JSON.stringify({ rows, more })
})()`

const closePicker = `(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  return document.querySelector('.lc-picker') ? 'still open' : 'closed'
})()`

const CHIP_AND_PANEL = `(async () => {
  const route = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  const effortChip = document.querySelector('.lc-composer__controls button[aria-label="Reasoning effort"]')
  if (!effortChip) return JSON.stringify({ route: route?.innerText.replace(/\\s+/g, ' ').trim() ?? '', panel: null })
  if (!document.querySelector('.lc-effortpanel')) effortChip.click()
  await new Promise(r => setTimeout(r, 500))
  const panel = document.querySelector('.lc-effortpanel')
  const out = {
    route: route?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    title: route?.getAttribute('title') ?? '',
    effortChip: effortChip.innerText.replace(/\\s+/g, ' ').trim(),
    now: panel?.querySelector('.lc-effortpanel__now')?.innerText.trim() ?? '',
    stops: panel ? panel.querySelectorAll('.lc-effortpanel__notch').length : 0,
    fastSwitch: panel ? [...panel.querySelectorAll('button, [role="switch"], input[type="checkbox"]')].some(n => /fast/i.test(n.getAttribute('aria-label') ?? n.innerText ?? '')) : false
  }
  effortChip.click()
  await new Promise(r => setTimeout(r, 300))
  return JSON.stringify(out)
})()`

const looksLikeAnId = (label) => /^[a-z0-9]+(?:[-.][a-z0-9]+)+$/.test(label)

try {
  await drive.ready()
  await drive.resize(1215, 800)
  // The catalogue arrives after the runtimes finish probing.
  let listed = { rows: [] }
  for (let attempt = 0; attempt < 30 && listed.rows.length === 0; attempt += 1) {
    listed = JSON.parse(await drive.evaluate(cursorRowsFor('your account claude')))
    if (listed.rows.length === 0) await new Promise((r) => setTimeout(r, 2000))
  }
  if (listed.rows.length === 0) throw new Error('Cursor listed nothing in the picker (is cursor-agent signed in?)')

  const seen = new Set()
  const twice = []
  for (const needle of ['your account claude opus', 'your account claude sonnet', 'your account claude fable', 'your account gpt', 'your account grok', 'your account gemini', 'your account kimi', 'your account glm', 'your account muse', 'your account composer', 'your account codex', 'your account auto']) {
    const found = JSON.parse(await drive.capture(`Cursor rows for "${needle}"`, () => drive.evaluate(cursorRowsFor(needle))))
    // Within one search, a name shown twice is two rows reading the same.
    twice.push(...found.rows.filter((row, index) => found.rows.indexOf(row) !== index))
    for (const row of found.rows) seen.add(row)
    say(`"${needle}": ${found.rows.join(' | ')}${found.more.length > 0 ? `   (${found.more.join('; ')})` : ''}`)
  }
  const rows = [...seen]
  check('no two Cursor rows read the same', twice.length === 0, twice.join(', '))
  const ids = rows.filter(looksLikeAnId)
  check('no Cursor row reads as an id', ids.length === 0, ids.length === 0 ? `${String(rows.length)} rows read` : ids.join(', '))
  check('Claude Opus 5.5 is one row, by its name', rows.filter((row) => /^Claude Opus 5\.5\b/.test(row)).length === 1, rows.filter((row) => /Opus 5\.5/.test(row)).join(' | '))
  const kimi = JSON.parse(await drive.evaluate(cursorRowsFor('your account kimi k3')))
  check('Kimi K3 is listed once', kimi.rows.filter((row) => row === 'Kimi K3').length === 1, kimi.rows.join(' | '))
  check('no Max, None or Minimal row of its own', !rows.some((row) => /\b(Max|None|Minimal)\b/.test(row)), rows.filter((row) => /\b(Max|None|Minimal)\b/.test(row)).join(' | '))
  await drive.evaluate(closePicker)

  say(await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'opus 5.5', row: '/^Claude Opus 5\\.5/' })))
  const opus = JSON.parse(await drive.capture('Cursor / Claude Opus 5.5 picked: the chip and the effort panel', () => drive.evaluate(CHIP_AND_PANEL)))
  say(`opus: ${JSON.stringify(opus)}`)
  check('the chip names the model, not an id', /Cursor \/ Claude Opus 5\.5/.test(opus.route) && !/5 5|opus-5/i.test(opus.route), opus.route)
  check('the effort panel offers its five levels, Max among them', opus.stops === 5, `${String(opus.stops)} stops`)
  check("and starts on Cursor's own default for it, Medium", /^Medium/.test(opus.now), opus.now)

  say(await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'kimi k3', row: '/^Kimi K3\\b/' })))
  const kimiRoute = JSON.parse(await drive.capture('Cursor / Kimi K3 picked', () => drive.evaluate(CHIP_AND_PANEL)))
  say(`kimi: ${JSON.stringify(kimiRoute)}`)
  check('Kimi K3 offers low, high and max', kimiRoute.stops === 3, `${String(kimiRoute.stops)} stops`)
  check("and starts on Max, the level Cursor lists as plain Kimi K3", /^Max/.test(kimiRoute.now), kimiRoute.now)

  say(failures === 0 ? '\nCURSOR NAMES PASSED' : `\nCURSOR NAMES: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "Cursor's rows in the picker, and the chip and effort panel on two of them. Nothing was sent." })
}
