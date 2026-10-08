// How much of the window the thread and the chat box use, at four sizes (0.515).
//
//   node _tools/drive-the-column-fills-the-window.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-01, beside Claude Code: "we seem to have a little more dead
// space on the side of our chats/chatbox compared to claude". One free reply,
// then the column and the box measured at 1024, 1280, 1600 and 1920 wide: the
// margin either side, and whether the reply and the box line up. Free model.

import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-column-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `column-fills-the-window-${tag}`,
  port: 9827,
  workspace,
  outPath: join(recordRoot('the-column-fills-the-window-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}
const SIZES = [
  { width: 1024, height: 720 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 }
]

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.evaluate(sendAndWaitScript('Write one paragraph of about eighty words on why rivers bend. No lists, no headings.'))
  for (const size of SIZES) {
    await drive.resize(size.width, size.height)
    const m = JSON.parse(String(await drive.capture(`${String(size.width)} wide`, () => drive.evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 900))
      const pane = document.querySelector('.lc-thread')?.getBoundingClientRect()
      const column = document.querySelector('.lc-thread__column')?.getBoundingClientRect()
      const box = document.querySelector('.lc-composer__inner')?.getBoundingClientRect()
      const reply = [...document.querySelectorAll('.lc-agentline__body')].at(-1)?.getBoundingClientRect()
      return JSON.stringify({
        pane: pane ? Math.round(pane.width) : null,
        column: column ? Math.round(column.width) : null,
        left: pane && column ? Math.round(column.left - pane.left) : null,
        right: pane && column ? Math.round(pane.right - column.right) : null,
        box: box ? Math.round(box.width) : null,
        boxLeft: box && column ? Math.round(box.left - column.left) : null,
        reply: reply ? Math.round(reply.width) : null,
        overflow: document.documentElement.scrollWidth > window.innerWidth
      })
    })()`))))
    say(`  ${String(size.width)}: ${JSON.stringify(m)}`)
    check(`${String(size.width)} wide: no sideways scroll, the box lines up with the column`, m.overflow === false && m.boxLeft !== null && Math.abs(m.boxLeft) <= 6, JSON.stringify(m))
    // The ceiling came down from 980px to 840px on 10/01 (0c1ad74d, Colin: line chats up with the box, as Claude does).
    check(`${String(size.width)} wide: margins either side of the column are under 100px, or the column is at its 840px ceiling`, m.column >= 835 || (m.left < 100 && m.right < 100), JSON.stringify(m))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on a free model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
