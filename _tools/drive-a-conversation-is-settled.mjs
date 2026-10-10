// A conversation settled from its menu leaves the sidebar, stays out after Locust opens again, and is found by a
// search and brought back from the same menu (0.730).
//
//   node _tools/drive-a-conversation-is-settled.mjs [--packaged <exe>]
//
// The everyday profile (sixteen conversations). Nothing is sent. The menu also offers Snooze, with its times;
// a snooze's end is covered by its tests (a-conversation-can-be-put-away.test.tsx), not waited for here.

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('a-conversation-is-settled-2026-10-10'), packaged === undefined ? 'local' : 'packaged')
const everyday = await seedEverydayLedger('drive-a-conversation-is-settled')
const TITLE = 'Rename the billing module'

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const ROWS = `[...document.querySelectorAll('.lc-conv')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')`
const menu = (pick) => `(async () => {
  const row = [...document.querySelectorAll('.lc-conv')].find((el) => el.innerText.includes(${JSON.stringify(TITLE)}))
  if (!row) return 'no row'
  const box = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
  await new Promise((r) => setTimeout(r, 500))
  const items = [...document.querySelectorAll('.lc-context__item')]
  const said = items.map((el) => el.innerText.trim().split('\\n')[0]).join(' / ')
  const item = items.find((el) => el.innerText.trim().startsWith(${JSON.stringify(pick)}))
  if (!item) return 'no ' + ${JSON.stringify(pick)} + ' in: ' + said
  item.click()
  await new Promise((r) => setTimeout(r, 1200))
  return 'pressed · menu: ' + said
})()`

let drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-conversation-is-settled',
  port: 9594,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  keep: true,
  outPath: OUT,
  seed: everyday.seed
})
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await sleep(2500)
  const pressed = String(await drive.capture('settled from the menu', () => drive.evaluate(menu('Settle'))))
  check('the menu offers Settle and Snooze, and Settle works', pressed.startsWith('pressed') && /Snooze/.test(pressed), pressed)
  const rows = String(await drive.evaluate(ROWS))
  check('the conversation is out of the sidebar, and the rest are not', !rows.includes(TITLE) && rows.includes('Fix the login redirect'), rows)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Settle a conversation from its menu.`, extra: `Checks failed so far: ${String(failures)}` })
}

drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-conversation-is-settled-again',
  port: 9595,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  outPath: join(OUT, 'after-relaunch')
})
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await sleep(2500)
  check('after Locust opens again it is still out of the sidebar', !String(await drive.evaluate(ROWS)).includes(TITLE))
  const found = String(
    await drive.capture('found by a search', () =>
      drive.evaluate(`(async () => {
        const box = document.querySelector('.lc-sidebar input[type="search"], .lc-sidebar input[placeholder^="Search"]')
        if (!box) return 'no search box'
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'billing')
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 800))
        return ${ROWS}
      })()`)
    )
  )
  check('a search finds it', found.includes(TITLE), found)
  const back = String(await drive.evaluate(menu('Bring back')))
  check('its menu says Bring back, and pressing it works', back.startsWith('pressed'), back)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-sidebar input[type="search"], .lc-sidebar input[placeholder^="Search"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, '')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 800))
  })()`)
  check('with the search cleared it is back in the list', String(await drive.capture('brought back', () => drive.evaluate(ROWS))).includes(TITLE))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The same profile, opened again.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
