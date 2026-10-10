// A conversation pinned from its menu stays pinned after Locust opens again (0.729).
//
//   node _tools/drive-a-conversation-is-pinned.mjs [--packaged <exe>]
//
// The everyday profile (sixteen conversations): right-click "Rename the billing module", press Pin to top, and
// the sidebar draws it first under Pinned with the rest under Recents. Then Locust is closed and opened again on
// the same profile, and the pin is read back from where it was kept. Nothing is sent.

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('a-conversation-is-pinned-2026-10-10'), packaged === undefined ? 'local' : 'packaged')
const everyday = await seedEverydayLedger('drive-a-conversation-is-pinned')
const TITLE = 'Rename the billing module'

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
/** The sidebar's headings and rows, top to bottom, as words. */
const LIST = `[...document.querySelectorAll('.lc-project__name, .lc-conv')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim().slice(0, 40)).join(' | ')`

let drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-conversation-is-pinned',
  port: 9592,
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
  const pressed = await drive.capture('pinned from the menu', () =>
    drive.evaluate(`(async () => {
      const row = [...document.querySelectorAll('.lc-conv')].find((el) => el.innerText.includes(${JSON.stringify(TITLE)}))
      if (!row) return 'no row'
      const box = row.getBoundingClientRect()
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
      await new Promise((r) => setTimeout(r, 500))
      const item = [...document.querySelectorAll('.lc-context__item')].find((el) => /Pin to top/.test(el.innerText))
      if (!item) return 'no Pin to top in: ' + [...document.querySelectorAll('.lc-context__item')].map((el) => el.innerText.trim()).join(' / ')
      item.click()
      await new Promise((r) => setTimeout(r, 1200))
      return 'pressed'
    })()`)
  )
  check('Pin to top is in the conversation’s menu, and pressing it works', pressed === 'pressed', pressed)
  const list = String(await drive.evaluate(LIST))
  check('the sidebar draws it first, under Pinned, and the rest under Recents', /^Pinned \| [^|]*Rename the billing[^|]* \| Recents \|/.test(list), list)
  check('and lists it once', list.split('Rename the billing').length - 1 === 1, list)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Pin a conversation from its menu.`, extra: `Checks failed so far: ${String(failures)}` })
}

// The same profile, opened again: the pin is read back from where it was kept.
drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-conversation-is-pinned-again',
  port: 9593,
  workspace: everyday.workspace,
  profilePath: everyday.profilePath,
  sendsNothing: true,
  outPath: join(OUT, 'after-relaunch')
})
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await sleep(2500)
  const list = String(await drive.capture('after Locust opens again', () => drive.evaluate(LIST)))
  check('after Locust opens again it is still pinned on top', /^Pinned \| [^|]*Rename the billing/.test(list), list)
  const unpinned = await drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-conv')].find((el) => el.innerText.includes(${JSON.stringify(TITLE)}))
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
    await new Promise((r) => setTimeout(r, 500))
    const item = [...document.querySelectorAll('.lc-context__item')].find((el) => /^Unpin/.test(el.innerText.trim()))
    if (!item) return 'no Unpin'
    item.click()
    await new Promise((r) => setTimeout(r, 1200))
    return ${LIST}
  })()`)
  check('Unpin puts it back where it was, and the list as it was', !/Pinned|Recents/.test(String(unpinned)), unpinned)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The same profile, opened again.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
