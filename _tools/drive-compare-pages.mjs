// Build and compare, rendered (0.446): two models each make a page; both run side by side.
//
//   node _tools/drive-compare-pages.mjs [--packaged <exe>] [--tag <name>]
//
// Free models only (OpenCode's free tier): spends nothing.
//
// PLAN-2026-09-28-NEXT item 4, after Arena's build starters, whose results
// render side by side; Colin, 2026-09-26: "people eat with their eyes". In a
// git project with no teammates: Compare models, two free models, Edit; one
// ask to make a landing page. Each column's page is written in its own copy
// and RUNS in its column -- a frame on its own origin -- not shown as code.
// Keep this one brings the kept page into the folder, and the kept
// conversation's page still runs once the copies are gone.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PICKS = (process.env.LOCUST_COMPARE_PICKS ?? 'nemotron-3-ultra-free,mimo-v2.6-flash-free').split(',')
const OUT = join(recordRoot('compare-pages-2026-09-28'), `compare-pages-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-compare-pages-ws-')
const drive = await startDrive({
  name: `compare-pages-${tag}`, port: 9780, workspace, outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** Each running page on screen: where it is served from, and whether it drew anything. */
const FRAMES = `[...document.querySelectorAll('iframe.lc-docpreview__frame')].map((frame) => ({ src: frame.getAttribute('src') ?? '', height: Math.round(frame.getBoundingClientRect().height), column: frame.closest('.lc-compare__cell') ? [...frame.closest('.lc-compare__cells').children].indexOf(frame.closest('.lc-compare__cell')) : -1 }))`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(4000)
  const picked = JSON.parse(String(await drive.evaluate(`(async () => {
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
    const labels = []
    for (const want of ${JSON.stringify(PICKS)}) {
      const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && one.querySelector('.lc-picker__label')?.textContent.trim() === want)
      if (!row) continue
      row.click()
      labels.push(want)
      await new Promise((r) => setTimeout(r, 250))
    }
    ;[...document.querySelectorAll('.lc-picker__foot--compare button')].find((b) => b.textContent.trim() === 'Done')?.click()
    await new Promise((r) => setTimeout(r, 500))
    document.querySelector('button[aria-label="Permission mode"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    ;[...document.querySelectorAll('.lc-menu[aria-label="What the comparison does"] .lc-menu__item')].find((item) => item.querySelector('.lc-menu__name')?.textContent.trim() === 'Edit')?.click()
    await new Promise((r) => setTimeout(r, 400))
    return JSON.stringify({ labels, mode: document.querySelector('button[aria-label="Permission mode"]')?.textContent.trim() ?? '' })
  })()`)))
  check('two free models, in Edit', picked.labels?.length === 2 && picked.mode === 'Edit', JSON.stringify(picked))

  const built = JSON.parse(String(await drive.capture('Both pages running side by side, each in its column', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Make index.html: a one-page landing page for a coffee shop called Ember, with a headline, three menu items with prices, and opening hours. One file, all CSS inside it, no scripts.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Start mission"]')?.click()
    for (let i = 0; i < 1600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const states = [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim())
      if (i > 6 && states.length === 2 && states.every((state) => state !== 'working' && state !== 'waiting')) break
    }
    for (let i = 0; i < 40 && document.querySelectorAll('iframe.lc-docpreview__frame').length < 2; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 2500))
    return JSON.stringify({
      heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
      frames: ${FRAMES},
      waits: [...document.querySelectorAll('.lc-docpreview__framewait')].map((el) => el.textContent.trim()),
      feet: [...document.querySelectorAll('.lc-compare__numbers')].map((el) => el.textContent.trim())
    })
  })()`))))
  say(`  built: ${JSON.stringify(built)}`)
  check('both columns are done', built.heads.length === 2 && built.heads.every((head) => / done$/.test(head)), JSON.stringify(built.heads))
  check('each column runs its own page, on the page scheme, in its own column', built.frames.length === 2 && built.frames.every((frame) => frame.src.startsWith('locust-page://') && frame.height > 150) && new Set(built.frames.map((frame) => frame.column)).size === 2 && built.frames[0].src !== built.frames[1].src, JSON.stringify(built.frames))
  check('no page says it is not there', built.waits.length === 0, JSON.stringify(built.waits))
  check("the folder has no page yet: they are each in a copy", !existsSync(join(workspace, 'index.html')))

  const kept = JSON.parse(String(await drive.capture('Kept: the page is in the folder, and it still runs in the conversation', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
    for (let i = 0; i < 60 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1500))
    for (let i = 0; i < 20 && document.querySelectorAll('iframe.lc-docpreview__frame').length === 0; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1500))
    return JSON.stringify({
      gone: document.querySelector('.lc-compare') === null,
      compared: document.querySelector('.lc-compared')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      frames: ${FRAMES},
      waits: [...document.querySelectorAll('.lc-docpreview__framewait')].map((el) => el.textContent.trim())
    })
  })()`))))
  say(`  kept: ${JSON.stringify(kept)}`)
  const page = existsSync(join(workspace, 'index.html')) ? readFileSync(join(workspace, 'index.html'), 'utf8') : ''
  check('the kept page came into the folder', /Ember/i.test(page) && /Its changes came into your folder: index\.html\./.test(kept.compared), JSON.stringify({ compared: kept.compared, bytes: page.length }))
  check('the kept conversation still runs the page, now from the folder', kept.gone && kept.frames.length >= 1 && kept.waits.length === 0, JSON.stringify(kept))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A git project, no teammates; two free OpenCode models each make a landing page in Edit, one kept.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
