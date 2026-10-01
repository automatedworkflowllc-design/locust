// What a brand-new person sees first: is the way to a teammate there, and do the words agree?
//
//   node _tools/drive-first-run-look.mjs [--packaged <exe>] [--tag <name>]
//
// A practice tester on 0.306 (Claude Code, driving as a newcomer; 7/10):
//  1. "Claude looked for how to make a teammate and found it only under an
//     unlabeled sidebar +; the three prominent mascot faces on Home looked
//     like the entry point but were decorative. The clearest definition ...
//     was below the fold in the teammate form."
//  2. "The compact mode control says Edit while its menu says Accept edits."
//  3. "The + menu's small icon-only items obscure the composer placeholder
//     when open."
// A fresh profile with no teammates; sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('beta-fixes-2026-09-23'), `first-run-look-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('starter-project-')
const drive = await startDrive({
  name: `first-run-look-${tag}`,
  port: 9517,
  workspace,
  outPath: OUT,
  sendsNothing: true,
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
  await drive.resize(1215, 800)
  await sleep(5000)

  const home = JSON.parse(String(await drive.capture('home, no teammates yet', () => drive.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'New teammate')
    return JSON.stringify({ button: button !== undefined, about: document.querySelector('.lc-firstteammate__about')?.textContent ?? null, teams: document.querySelectorAll('.lc-teamtemplate').length })
  })()`))))
  // Since the team templates the empty home offers three teams beside New
  // teammate; the old fallback still says what a teammate is.
  check('the home screen offers a teammate by name, or a team', home.button === true && (home.teams === 3 || /grants no new access/.test(home.about ?? '')), JSON.stringify(home))

  const form = JSON.parse(String(await drive.capture('New teammate, from the home screen', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'New teammate')?.click()
    await new Promise((r) => setTimeout(r, 900))
    const body = document.querySelector('.lc-dialog .lc-dialog__body')
    const first = body?.firstElementChild
    return JSON.stringify({ open: body !== null, first: first?.textContent?.trim() ?? null })
  })()`))))
  check('it opens the form, which says first what a teammate is', form.open === true && /^A teammate is a name, a face and a place to keep missions/.test(form.first ?? ''), JSON.stringify(form))
  await drive.evaluate(`(() => { [...document.querySelectorAll('.lc-dialog button')].find((b) => /^Cancel$/.test(b.textContent.trim()))?.click() })()`)
  await sleep(500)

  const words = JSON.parse(String(await drive.capture('the mode chip and its menu', () => drive.evaluate(`(async () => {
    const chip = [...document.querySelectorAll('button.lc-control')].find((b) => /^(Edit|Ask|Plan|Approve|Auto)\\b/.test((b.textContent ?? '').trim()))
    const chipWord = (chip?.textContent ?? '').trim()
    chip?.click()
    await new Promise((r) => setTimeout(r, 500))
    const names = [...document.querySelectorAll('.lc-menu__name')].map((n) => n.textContent.trim())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return JSON.stringify({ chip: chipWord, menu: names })
  })()`))))
  check('the mode chip and its menu use the same word', words.menu.includes(words.chip.replace(/\\s.*$/, '')) && !words.menu.includes('Accept edits'), JSON.stringify(words))

  const plus = JSON.parse(String(await drive.capture('the + menu open over the box', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-plusmenu__main')?.click()
    await new Promise((r) => setTimeout(r, 700))
    const box = document.querySelector('textarea[aria-label="Message"]')
    return JSON.stringify({ open: document.querySelector('.lc-plusmenu.is-open') !== null, placeholder: box ? getComputedStyle(box, '::placeholder').color : null })
  })()`))))
  check('the + menu open, the box placeholder steps aside', plus.open === true && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(plus.placeholder ?? ''), JSON.stringify(plus))
  say(failures === 0 ? '\nFIRST RUN LOOK PASSED' : `\nFIRST RUN LOOK: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "A fresh profile with no teammates: the home screen's way to one, the form's first line, the mode's one word, the + menu over the box. Sends nothing." })
}
