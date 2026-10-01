// Build and compare from Home, in a folder that is NOT a git project (0.448).
//
//   node _tools/drive-build-and-compare.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only (OpenCode's free tier): spends nothing.
//
// Colin, 2026-09-28, to "a starter makes its own new project folder inside
// Documents\Locust": "Keep working big dog". Switching folders restarts the
// app, which is not clean -- so comparisons that edit now work in any folder,
// each column in a plain copy, and the starter runs where the person is. A new
// person's folder with no git and no teammates: Home's "A landing page" puts
// its words in the box, sets the comparison to Edit and opens the picker; two
// free models ticked; each builds its page in its own copy and runs it in its
// column; the folder is untouched until Keep brings the kept page in.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'nemotron-3-ultra-free,mimo-v2.6-flash-free').split(',')
const OUT = join(recordRoot('build-and-compare-2026-09-28'), `build-and-compare-${tag}`)
await mkdir(OUT, { recursive: true })

// Not a git project: a plain folder, the way Documents\Locust starts.
const workspace = await mkdtemp(join(tmpdir(), 'locust-drive-build-compare-ws-'))
await writeFile(join(workspace, 'notes.md'), 'My folder.\n', 'utf8')
const COPIES = join(homedir(), '.locust', 'compare')
const copiesNow = () => (existsSync(COPIES) ? readdirSync(COPIES) : [])
const before = new Set(copiesNow())

const drive = await startDrive({
  name: `build-and-compare-${tag}`, port: 9783, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const FRAMES = `[...document.querySelectorAll('iframe.lc-docpreview__frame')].map((frame) => ({ src: frame.getAttribute('src') ?? '', height: Math.round(frame.getBoundingClientRect().height), column: frame.closest('.lc-compare__cell') ? [...frame.closest('.lc-compare__cells').children].indexOf(frame.closest('.lc-compare__cell')) : -1 }))`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(4000)
  const home = JSON.parse(String(await drive.capture('Home: Build and compare, under the agents', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('.lc-buildhead'); i += 1) await new Promise((r) => setTimeout(r, 500))
    const scroller = document.querySelector('.lc-home, .lc-firstlaunch, main') ?? document.scrollingElement
    return JSON.stringify({
      starters: [...document.querySelectorAll('.lc-buildcard .lc-buildcard__name')].map((b) => b.textContent.trim()),
      fits: document.scrollingElement.scrollHeight <= window.innerHeight + 1,
      overflow: [...document.querySelectorAll('*')].filter((el) => el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY === 'auto').map((el) => el.className.toString().split(' ')[0] + ':' + (el.scrollHeight - el.clientHeight)).slice(0, 4)
    })
  })()`))))
  say(`  home: ${JSON.stringify(home)}`)
  check('Home offers three things to build and compare', home.starters?.join('|') === 'Landing page|Sales dashboard|Arcade game', JSON.stringify(home))

  // 0.460, as Arena: the card puts the words in the box and TWO models beside
  // them, each its own dropdown; each is set to a free model from its own.
  const started = JSON.parse(String(await drive.capture('A landing page: its words in the box, Edit, two model dropdowns', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-buildcard')].find((b) => b.querySelector('.lc-buildcard__name')?.textContent.trim() === 'Landing page')?.click()
    await new Promise((r) => setTimeout(r, 900))
    // Direct, Compare or Blind lives in the chat mode chip since 0.451.
    const on = document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label')?.replace('Chat mode: ', '') ?? ''
    const defaults = [...document.querySelectorAll('.lc-control--slot .lc-control__model')].map((el) => el.textContent.trim())
    const pickerOpenedByItself = document.querySelector('.lc-picker') !== null
    const labels = []
    const wants = ${JSON.stringify(PICKS)}
    for (let index = 0; index < wants.length; index += 1) {
      const chip = document.querySelectorAll('.lc-control--slot')[index]
      chip?.click()
      await new Promise((r) => setTimeout(r, 600))
      const box = document.querySelector('.lc-picker__input')
      const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setInput.call(box, 'free')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
      const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && one.querySelector('.lc-picker__label')?.textContent.trim() === wants[index])
      row?.click()
      await new Promise((r) => setTimeout(r, 400))
      labels.push(document.querySelectorAll('.lc-control--slot .lc-control__model')[index]?.textContent.trim() ?? '')
    }
    return JSON.stringify({
      on,
      defaults,
      pickerOpenedByItself,
      labels,
      plus: document.querySelector('.lc-control--addslot') !== null,
      text: document.querySelector('form.command-dock textarea')?.value ?? '',
      mode: document.querySelector('button[aria-label="Permission mode"]')?.textContent.trim() ?? ''
    })
  })()`))))
  say(`  started: ${JSON.stringify(started)}`)
  check('the card puts its words in the box, sets Edit, and starts on two models, each its own dropdown', /^Make index\.html: a one-page landing page/.test(started.text) && started.mode === 'Edit' && started.on === 'Compare' && started.defaults.length === 2 && started.defaults[0] !== started.defaults[1] && !started.pickerOpenedByItself && started.plus === true, JSON.stringify(started))
  // The chip names a model as the route chip does ("Nemotron 3 Ultra Free"); the picker row by its id.
  const asId = (label) => label.toLowerCase().replace(/\s+/g, '-')
  check('each dropdown sets its own column: the two free models', started.labels.map(asId).join('|') === PICKS.join('|'), JSON.stringify(started.labels))

  const built = JSON.parse(String(await drive.capture('Both pages running side by side, each built in its own copy', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Send"]')?.click()
    for (let i = 0; i < 1600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const states = [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
      if (i > 6 && states.length === 2 && states.every((state) => state !== 'working' && state !== 'waiting')) break
    }
    for (let i = 0; i < 40 && [...document.querySelectorAll('.lc-compare__numbers')].some((el) => !/in \\d+ files?|files? changed|no changes/.test(el.textContent)); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 2500))
    return JSON.stringify({
      heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
      bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      frames: ${FRAMES},
      waits: [...document.querySelectorAll('.lc-docpreview__framewait')].map((el) => el.textContent.trim()),
      feet: [...document.querySelectorAll('.lc-compare__numbers')].map((el) => el.textContent.trim()),
      // The file names Locust shows. A model's own command is drawn as it ran it, copy path and all.
      internal: [...document.querySelectorAll('.lc-compare .lc-filerow:not(.is-shell) .lc-filerow__path')].some((el) => el.innerText.includes('.locust'))
    })
  })()`))))
  say(`  built: ${JSON.stringify(built)}`)
  const mine = copiesNow().filter((name) => !before.has(name))
  check('both columns are done', built.heads.length === 2 && built.heads.every((head) => / done$/.test(head)), JSON.stringify(built.heads))
  check('each column runs its own page, from its own copy', built.frames.length === 2 && built.frames.every((frame) => frame.src.startsWith('locust-page://') && frame.height > 150) && new Set(built.frames.map((frame) => frame.column)).size === 2 && built.frames[0].src !== built.frames[1].src && built.waits.length === 0, JSON.stringify({ frames: built.frames, waits: built.waits }))
  // 0.450: each column's page first in its cell, so the pages line up, and none runs twice.
  const tops = await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-compare__page iframe')].map((frame) => Math.round(frame.getBoundingClientRect().top)))`)
  const aligned = JSON.parse(String(tops))
  check('the two pages start level, first in their columns, and neither runs twice', aligned.length === 2 && Math.abs(aligned[0] - aligned[1]) <= 2 && built.frames.length === 2, JSON.stringify({ tops: aligned, frames: built.frames.length }))
  check('each foot says what its model changed', built.feet.length === 2 && built.feet.every((foot) => /^\+\d+ −\d+ in 1 file/.test(foot)), JSON.stringify(built.feet))
  check('no row shows a copy\'s own path', built.internal === false)
  check('the folder is untouched while they build: the copies are outside it', !existsSync(join(workspace, 'index.html')) && mine.filter((name) => !name.endsWith('.json')).length === 2, JSON.stringify({ mine, folder: readdirSync(workspace) }))

  const kept = JSON.parse(String(await drive.capture('Kept: the page is in the folder and still runs', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
    for (let i = 0; i < 60 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1500))
    for (let i = 0; i < 20 && document.querySelectorAll('iframe.lc-docpreview__frame').length === 0; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1500))
    return JSON.stringify({
      gone: document.querySelector('.lc-compare') === null,
      problem: document.querySelector('.lc-compare__problem')?.textContent ?? '',
      compared: document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      frames: ${FRAMES},
      waits: [...document.querySelectorAll('.lc-docpreview__framewait')].map((el) => el.textContent.trim())
    })
  })()`))))
  say(`  kept: ${JSON.stringify(kept)}`)
  const page = existsSync(join(workspace, 'index.html')) ? readFileSync(join(workspace, 'index.html'), 'utf8') : ''
  check('Keep brings the kept page into the folder, and says so', page.length > 200 && /Its changes came into your folder: index\.html\./.test(kept.compared) && readFileSync(join(workspace, 'notes.md'), 'utf8') === 'My folder.\n', JSON.stringify({ compared: kept.compared, problem: kept.problem, bytes: page.length }))
  check('the kept page still runs in the conversation', kept.gone && kept.frames.length >= 1 && kept.waits.length === 0, JSON.stringify(kept))
  check('both copies are removed', copiesNow().filter((name) => !before.has(name)).length === 0, JSON.stringify(copiesNow().filter((name) => !before.has(name))))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A plain folder (no git), no teammates; Home's "A landing page" starter, two free OpenCode models, one kept.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
