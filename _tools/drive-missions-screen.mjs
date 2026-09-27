// Fresh-eyes area 9: the Missions screen, with a list a person has.
//
//   node _tools/drive-missions-screen.mjs [--packaged <exe>] [--tag <name>]
//
// The everyday profile (everyday-ledger.mjs). Opens Missions from the
// sidebar and reads it the way a person would: the header's count against
// the sidebar's, the rows, the filters, opening one, and selecting two to
// delete. At 1440, 1120 and 1920. Sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { seedEverydayLedger } from './everyday-ledger.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('missions-screen-2026-09-27'), `missions-screen-${tag}`)
await mkdir(OUT, { recursive: true })

const everyday = await seedEverydayLedger('missions-screen')
say(`seeded ${String(everyday.missions)} missions, ${String(everyday.conversations)} conversations`)

const drive = await startDrive({
  name: `missions-screen-${tag}`, port: 9743, workspace: everyday.workspace, profilePath: everyday.profilePath, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: everyday.seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const read = `JSON.stringify({
  meta: document.querySelector('.lc-screen .lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '',
  filters: [...document.querySelectorAll('.lc-screen .lc-filter')].map((b) => b.innerText),
  rows: [...document.querySelectorAll('.lc-missionrow')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()),
  sidebar: [...document.querySelectorAll('.lc-convrow')].filter((r) => r.getBoundingClientRect().height > 0).length
})`
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2500)
  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Missions/.test(b.innerText))?.click()`)
  await sleep(1200)
  const seen = JSON.parse(String(await drive.capture('Missions, 1440', () => drive.evaluate(read))))
  say(`  header: ${seen.meta}`)
  say(`  filters: ${JSON.stringify(seen.filters)}`)
  for (const row of seen.rows) say(`    row: ${row}`)
  check('one row per conversation, as the sidebar lists them: 16', seen.rows.length === 16 && seen.sidebar === 16, `${String(seen.rows.length)} rows, sidebar ${String(seen.sidebar)}`)
  check('the header counts the same 16 conversations', /\b16 conversations\b/.test(seen.meta), seen.meta)
  check('no follow-up stands alone as a row ("Good, ship it")', !seen.rows.some((row) => /^Good, ship it/.test(row)), JSON.stringify(seen.rows.slice(0, 3)))
  check('the three-turn conversation is one row, named by its first turn, saying 3 turns', /^Fix the login redirect loop.*3 turns/.test(seen.rows[0] ?? ''), seen.rows[0])
  // Counted from when the newest turn ended, so a few minutes, not an exact figure.
  const whenOf = (row) => /(?:^|\s)(\d+[mhdw])\s/.exec(row)?.[1]
  check('every row says when: minutes on the newest, 5w on the oldest', seen.rows.every((row) => whenOf(row) !== undefined) && /m$/.test(whenOf(seen.rows[0] ?? '') ?? '') && whenOf(seen.rows[seen.rows.length - 1] ?? '') === '5w', seen.rows.map(whenOf).join(' '))
  // A title is the row's point: at 1440 it must carry the words, not 27 characters of them.
  const titleWidth = Number(await drive.evaluate(`Math.round(document.querySelector('.lc-missionrow__name')?.getBoundingClientRect().width ?? 0)`))
  check('at 1440 the title has room: its column is at least 440px', titleWidth >= 440, `${String(titleWidth)}px`)

  const opened = String(await drive.capture('open the three-turn conversation from Missions', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-missionrow')].find((r) => /login redirect/i.test(r.innerText))
    row?.click()
    await new Promise((r) => setTimeout(r, 1500))
    return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
  })()`)))
  check('opening it opens the whole conversation, all three turns', /redirect loop/.test(opened) && /signup form does/.test(opened) && /ship it/i.test(opened), opened.slice(-200))

  await drive.evaluate(`[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Missions/.test(b.innerText))?.click()`)
  await sleep(1000)
  const picked = JSON.parse(String(await drive.capture('select two', () => drive.evaluate(`(async () => {
    const boxes = [...document.querySelectorAll('.lc-missionrow__pick')].filter((b) => !b.disabled)
    const titles = []
    for (const box of boxes.slice(-2)) { box.click(); titles.push(box.getAttribute('aria-label')) }
    await new Promise((r) => setTimeout(r, 300))
    return JSON.stringify({ titles, bar: document.querySelector('.lc-pickbar')?.innerText.replace(/\\s+/g, ' ') ?? '' })
  })()`))))
  say(`  picked: ${JSON.stringify(picked)}`)
  check('picking two shows the bar with Delete 2', /2 selected/.test(picked.bar) && /Delete 2/.test(picked.bar) && /Select all 16/.test(picked.bar), picked.bar)
  const deleted = JSON.parse(String(await drive.capture('Delete, then Delete for good', () => drive.evaluate(`(async () => {
    const del = () => document.querySelector('.lc-pickbar__delete')
    del().click()
    await new Promise((r) => setTimeout(r, 300))
    const armed = del()?.innerText ?? ''
    del()?.click()
    await new Promise((r) => setTimeout(r, 2000))
    return JSON.stringify({ armed, after: JSON.parse(${read}) })
  })()`))))
  say(`  armed: ${deleted.armed}; header after: ${deleted.after.meta}; sidebar ${String(deleted.after.sidebar)}`)
  check('the second press asks "for good?"', /for good/i.test(deleted.armed), deleted.armed)
  check('two are gone from the screen and from the sidebar', deleted.after.rows.length === seen.rows.length - 2 && deleted.after.sidebar === 14, `${String(deleted.after.rows.length)} rows, sidebar ${String(deleted.after.sidebar)}`)

  for (const [w, h] of [[1120, 760], [1920, 1080]]) {
    await drive.resize(w, h)
    await sleep(1500)
    const at = JSON.parse(String(await drive.capture(`Missions, ${String(w)}`, () => drive.evaluate(`JSON.stringify({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: [...document.querySelectorAll('.lc-missionrow > span')].filter((s) => s.scrollWidth > s.clientWidth + 1 && !s.classList.contains('lc-missionrow__name')).map((s) => s.className + ': ' + s.innerText).slice(0, 5)
    })`))))
    check(`at ${String(w)}: nothing scrolls sideways and no column is cut`, at.overflow <= 0 && at.clipped.length === 0, JSON.stringify(at))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. The everyday profile: 16 conversations (18 turns), four teammates.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
