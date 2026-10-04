// The sidebar, set up like Claude's (0.486): photographed with projects.
//
//   node _tools/drive-sidebar-like-claude.mjs [--packaged <exe>]
//
// Colin, 2026-09-30, with a screenshot of Claude's sidebar: "switch 'not in a
// project' to 'Ungrouped'", "remove the random numbers, literally set it up
// exactly how claude code has their sidebar". Seeds the everyday profile,
// makes two projects through the app's own calls, files conversations into
// them, reloads, and reads the sidebar: the places list at the top, project
// names with no counts and no icons, an "Ungrouped" heading, and rows with no
// ages. Photographed at 1440 and 1120. Sends nothing.

import { seedEverydayLedger } from './everyday-ledger.mjs'
import { say, sleep, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const everyday = await seedEverydayLedger('sidebar-claude')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'sidebar-like-claude', port: 9769, workspace: everyday.workspace, profilePath: everyday.profilePath, sendsNothing: true,
  seed: everyday.seed
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const read = `JSON.stringify({
  places: [...document.querySelectorAll('.lc-sidebar__places button')].map((b) => b.innerText.trim()),
  heads: [...document.querySelectorAll('.lc-project__head')].map((h) => h.innerText.replace(/\\s+/g, ' ').trim()),
  headIcons: document.querySelectorAll('.lc-project__head svg').length,
  ages: document.querySelectorAll('.lc-sidebar .lc-conv__age').length,
  footer: document.querySelector('.lc-sidebar__footer')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
})`
try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1440, 900)
  await drive.evaluate(`(async () => {
    const history = await window.desktop.getMissionHistory()
    const ids = history.ok ? history.data.missions.map((m) => m.missionId) : []
    await window.desktop.createGroup('Investments')
    await window.desktop.createGroup('Locust')
    const groups = await window.desktop.listGroups()
    const byName = Object.fromEntries((groups.ok ? groups.data.groups : []).map((g) => [g.name, g.groupId]))
    for (const id of ids.slice(0, 3)) await window.desktop.assignGroup(id, byName.Investments)
    for (const id of ids.slice(3, 7)) await window.desktop.assignGroup(id, byName.Locust)
    location.reload()
  })()`).catch(() => undefined)
  await sleep(4000)
  const wide = JSON.parse(String(await drive.capture('1440: the sidebar with two projects', () => drive.evaluate(read))))
  say(`  ${JSON.stringify(wide)}`)
  // Renamed Conversations in 0.526; rows with counts since 0.605, so the count is stripped before the words are compared.
  check('the places are a list at the top: Conversations, Rooms, Routines', JSON.stringify(wide.places.map((text) => text.replace(/\s*\d+$/, ''))) === JSON.stringify(['Conversations', 'Rooms', 'Routines']), JSON.stringify(wide.places))
  check('project headings are names alone: no count, no icon', wide.heads.includes('Investments') && wide.heads.includes('Locust') && wide.heads.every((h) => !/\d/.test(h)) && wide.headIcons === 0, JSON.stringify({ heads: wide.heads, icons: wide.headIcons }))
  check('the rest are under "Ungrouped"', wide.heads.includes('Ungrouped'), JSON.stringify(wide.heads))
  check('rows carry no ages', wide.ages === 0, String(wide.ages))
  check('the footer keeps Settings and the status', /Settings/.test(wide.footer) && /connected/.test(wide.footer), wide.footer)
  await drive.resize(1120, 720)
  await sleep(800)
  await drive.capture('1120: the narrow rail', () => drive.evaluate(read))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The everyday profile with two projects; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
