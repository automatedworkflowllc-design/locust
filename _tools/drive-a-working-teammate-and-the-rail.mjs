// QA-2026-09-29 round 2, R27 and R22, in the packaged app.
//
//   node _tools/drive-a-working-teammate-and-the-rail.mjs [--packaged <exe>] [--tag <name>]
//
// R27: at 1280 wide the sidebar is the compact rail. A teammate's card pinned
// by a click must close when Ctrl+1 opens Missions -- and a click on a face
// FROM Missions must still open the conversation with its card.
// R22: removing a teammate while it runs says so in the menu, and stops the run.
// The free OpenCode model; the run is a long ping.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('a-working-teammate-2026-09-29'), `a-working-teammate-${tag}`)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-drive-working-ws-')
const T0 = '2026-09-29T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-working-teammate-${tag}`, port: 9793, workspace, outPath: OUT, launchElsewhere: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: { ...FREE_ROUTE, mode: 'accept-edits' } },
      { teammateId: 'tm_pip', name: 'Pip', hue: 'blue', role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: { ...FREE_ROUTE, mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const face = (name) => `[...document.querySelectorAll('.lc-railslot button')].find((b) => ((b.getAttribute('aria-label') ?? b.title ?? '')).startsWith(${JSON.stringify(name)}))`
const cardOpen = `!!document.querySelector('.lc-railflyout')`
const ctrl = async (key) => {
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Digit${key}`, modifiers: 2, windowsVirtualKeyCode: 48 + Number(key) })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Digit${key}`, modifiers: 2, windowsVirtualKeyCode: 48 + Number(key) })
  await sleep(700)
}

try {
  await drive.ready()
  await drive.resize(1280, 800)
  await sleep(1500)

  // R27
  const pinned = await drive.evaluate(`(async () => { ${face('Pip')}?.click(); await new Promise((r) => setTimeout(r, 600)); return ${cardOpen} })()`)
  await drive.capture('Pip’s card pinned from the rail', () => drive.evaluate(cardOpen))
  check('a click on a face in the rail pins its card', pinned === true, String(pinned))
  await drive.evaluate(`document.activeElement?.blur()`)
  await ctrl('1')
  const afterShortcut = JSON.parse(String(await drive.capture('Ctrl+1: Missions', () => drive.evaluate(`JSON.stringify({ card: ${cardOpen}, missions: !!document.querySelector('.lc-screen') })`))))
  check('Ctrl+1 opens Missions and the card closes', afterShortcut.missions === true && afterShortcut.card === false, JSON.stringify(afterShortcut))
  const fromMissions = JSON.parse(String(await drive.capture('a face clicked from Missions', () => drive.evaluate(`(async () => { ${face('Pip')}?.click(); await new Promise((r) => setTimeout(r, 800)); return JSON.stringify({ card: ${cardOpen}, composer: !!document.querySelector('form.command-dock textarea') }) })()`))))
  check('from Missions, a face still opens the conversation with its card', fromMissions.card === true && fromMissions.composer === true, JSON.stringify(fromMissions))
  await drive.evaluate(`${face('Pip')}?.click()`)
  await sleep(400)

  // R22
  await drive.evaluate(openTeammateScript('Ash'))
  await sleep(600)
  await drive.evaluate(sendAndWaitScript('Run this exact shell command once: ping -n 60 127.0.0.1 . Then reply with the single word FINISHED.', { settle: false }))
  let running = false
  for (let i = 0; i < 60 && !running; i += 1) {
    await sleep(1000)
    running = (await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`)) === true
  }
  check('Ash is working', running, String(running))
  const menu = JSON.parse(String(await drive.capture('Remove, while Ash works', () => drive.evaluate(`(async () => {
    const slot = ${face('Ash')}
    const box = slot?.getBoundingClientRect()
    slot?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: (box?.left ?? 0) + 10, clientY: (box?.top ?? 0) + 10 }))
    await new Promise((r) => setTimeout(r, 500))
    const item = [...document.querySelectorAll('.lc-context__item')].find((one) => /Remove teammate/.test(one.textContent))
    item?.click()
    await new Promise((r) => setTimeout(r, 400))
    const armed = [...document.querySelectorAll('.lc-context__item')].map((one) => one.textContent.trim()).find((text) => /^Remove/.test(text)) ?? ''
    return JSON.stringify({ item: !!item, armed })
  })()`))))
  check('the menu says removing stops what Ash is running', menu.armed === 'Remove, and stop what they are running?', JSON.stringify(menu))
  await drive.evaluate(`[...document.querySelectorAll('.lc-context__item')].find((one) => /^Remove, and stop/.test(one.textContent.trim()))?.click()`)
  let stopped = false
  for (let i = 0; i < 30 && !stopped; i += 1) {
    await sleep(1000)
    stopped = (await drive.evaluate(`!document.querySelector('button[aria-label^="Stop the running"]') && !/1 running/.test(document.body.innerText)`)) === true
  }
  const end = String(await drive.capture('Ash removed', () => drive.evaluate(`JSON.stringify({ faces: [...document.querySelectorAll('.lc-railslot button')].map((b) => (b.getAttribute('aria-label') ?? b.title ?? '').split(/[,.]/)[0]), running: /\\d+ running/.exec(document.body.innerText)?.[0] ?? 'none' })`)))
  check('removing Ash stops the run, and Ash is gone', stopped && !/Ash/.test(JSON.parse(end).faces.join(' ')), end)
} finally {
  await drive.finish({ intro: 'The rail card closes on another screen (R27); a working teammate removed is stopped (R22).' })
}
say('')
say(`record: ${OUT}`)
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
