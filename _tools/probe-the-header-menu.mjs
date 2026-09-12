// What the conversation header offers, now that it is a menu.
//
//   node _tools/probe-the-header-menu.mjs
//
// Colin, 2026-09-11: "lets clean up this area with maybe a triple dot
// dropdown or something." Four buttons across the top of every conversation
// became one, and Delete moved inside it -- which reverses a 2026-09-04
// design note that kept Delete OUT of a menu on the grounds that hiding the
// one destructive action makes it harder to find deliberately.
//
// So this probe asks the two questions that note was really about: is the
// action still NAMED where a person will meet it, and does it still ask
// before it acts. It drives the menu open and presses Delete ONCE, which
// must arm rather than delete.
//
// It SPENDS NOTHING: it reads a mission that already exists and never
// confirms the deletion.

import { cp, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { say, startDrive } from './drive-lib.mjs'

const HIS = join(process.env.APPDATA ?? '', '@teammate', 'desktop')
const LEDGER = 'mission_645f02a4-40b4-4b9e-9c71-bd29c451da7c.jsonl'

const profile = await mkdtemp(join(tmpdir(), 'locust-header-menu-'))
await mkdir(join(profile, 'mission-ledger'), { recursive: true })
await cp(join(HIS, 'mission-ledger', LEDGER), join(profile, 'mission-ledger', LEDGER))
for (const file of ['teammates.json', 'workspace.json']) {
  await cp(join(HIS, file), join(profile, file)).catch(() => undefined)
}

const drive = await startDrive({
  name: 'the-header-menu',
  port: 9508,
  workspace: process.cwd(),
  profilePath: profile
})

// No backticks inside these template literals.
const open = `(async () => {
  const missions = [...document.querySelectorAll('button, a')].find(n => /^Missions$/.test(n.innerText.trim()))
  if (missions === undefined) return 'no Missions button'
  missions.click()
  await new Promise(r => setTimeout(r, 1200))
  const row = [...document.querySelectorAll('.lc-missionrow, .lc-row')].find(n => /google as a stock/i.test(n.innerText))
  if (row === undefined) return 'no row for that mission'
  row.click()
  await new Promise(r => setTimeout(r, 1800))
  const header = document.querySelector('.lc-thread__header, header')
  const more = document.querySelector('[aria-label="More actions"]')
  if (more === null) return 'no more-actions control'
  more.click()
  await new Promise(r => setTimeout(r, 500))
  const menu = document.querySelector('.lc-context')
  return JSON.stringify({
    headerButtons: header === null ? 0 : header.querySelectorAll('button').length,
    menuOpen: menu !== null,
    items: menu === null ? [] : [...menu.querySelectorAll('[role="menuitem"]')].map(n => n.innerText.trim()),
    // The action is NAMED, which is the half of the old objection that
    // mattered: a person finds out it exists by reading it.
    namesDelete: menu !== null && /Delete conversation/.test(menu.innerText)
  }, null, 1)
})()`

const arms = `(async () => {
  const menu = document.querySelector('.lc-context')
  if (menu === null) return 'the menu closed'
  const item = [...menu.querySelectorAll('[role="menuitem"]')].find(n => /Delete conversation/.test(n.innerText))
  if (item === undefined) return 'no delete item'
  item.click()
  await new Promise(r => setTimeout(r, 400))
  const after = document.querySelector('.lc-context')
  const thread = document.body.innerText
  return JSON.stringify({
    // One press must ASK, not act.
    stillOpen: after !== null,
    asks: after !== null && /Delete for good\?/.test(after.innerText),
    conversationStillHere: /google as a stock/i.test(thread)
  }, null, 1)
})()`

try {
  await drive.capture('the header is one control, and it names what it holds', async () => {
    await drive.ready()
    return drive.evaluate(open)
  })
  await drive.capture('pressing Delete once asks rather than deletes', () => drive.evaluate(arms))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The conversation header after the four buttons became one. Delete is inside the menu now, and the menu asks in place -- the same second press the header button used to make.'
  })
}
