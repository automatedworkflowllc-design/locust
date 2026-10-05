// Home rests when nobody is there, and wakes at a touch (0.623).
//
//   node _tools/drive-home-rests.mjs [--packaged <exe>] [--tag <name>]
//
// Colin's Task Manager put Locust at rest at about 6% of a 12-core machine, drawing a Home cover nobody
// was watching. 0.623 holds the cover's frame after 45 s without input (useCoverActivity.ts). This checks
// the behaviour, not a CPU number, so it holds on a busy machine (the CPU probe,
// probe-locust-cpu-by-state.mjs, needs a quiet one): Home with the window focused (emulated), animating;
// after 50 s untouched, the cover marked paused and nothing running; one pointer move, and it animates
// again within a second. Sends nothing.

import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-home-rests-ws-')
const at = '2026-09-10T09:00:00.000Z'
const drive = await startDrive({
  name: `home-rests-${tag}`, port: 9918, workspace, sendsNothing: true,
  outPath: join(recordRoot('home-rests-2026-10-05'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: FREE_ROUTE },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: at, route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const state = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify({
  cover: Boolean(document.querySelector('.lc-cover')),
  paused: document.querySelector('.lc-cover')?.classList.contains('is-paused') ?? null,
  running: document.getAnimations().filter((a) => a.playState === 'running').length,
  focused: document.hasFocus()
})`)))
try {
  await drive.ready()
  await drive.resize(1200, 780)
  // An automated window is not the focused one; the cover rightly holds still while unfocused.
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  for (let i = 0; i < 40 && !(await state()).cover; i += 1) await sleep(500)
  await drive.evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 600, clientY: 400 }))`)
  await sleep(1500)
  const awake = await drive.capture('Home, just touched', () => state())
  check('Home shows the cover, animating, after a touch', awake.cover && awake.paused === false && awake.running > 0, JSON.stringify(awake))
  await sleep(50_000)
  const rested = await drive.capture('Home, 50 s untouched', () => state())
  check('after 50 s untouched: the cover holds its frame, nothing running', rested.paused === true && rested.running === 0, JSON.stringify(rested))
  await drive.evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 610, clientY: 410 }))`)
  await sleep(1000)
  const woke = await drive.capture('one pointer move', () => state())
  check('one pointer move: it animates again within a second', woke.paused === false && woke.running > 0, JSON.stringify(woke))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Home rests after 45 s and wakes at a touch.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
