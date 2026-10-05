// What a face says (Settings > Appearance, 2026-10-05): the legend at two
// window sizes, going through its faces, a click showing the next, and resting
// by the cover's rule -- behind other windows, and with reduced motion asked
// for -- where it draws nothing at all.
//
//   node _tools/drive-face-legend.mjs [--packaged <exe>] [--tag <name>] [--out <dir>]
//
// Colin, of the faces: "we want the user to be able to see how much
// versatility the eyes have"; of the legend: "if its clean and production
// ready we can just ship it". Frames of the row at each size are kept in the
// record (steps named "legend at ..."). Sends nothing.

import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const at = '2026-10-05T09:00:00.000Z'
const drive = await startDrive({
  name: `face-legend-${tag}`,
  port: 9933,
  workspace: await scratchRepository('locust-drive-face-legend-ws-'),
  sendsNothing: true,
  outPath: arg('--out') ?? join(recordRoot('face-legend-2026-10-05'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}

// Settings > Appearance, the legend in view; the legend's canvas made to count the frames it draws.
const openAppearance = `(async () => {
  // Settings, unless it is open already.
  for (let i = 0; i < 40 && !document.querySelector('.lc-settings__pane'); i += 1) {
    const settings = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Settings')
    if (settings) settings.click()
    await new Promise((r) => setTimeout(r, 400))
  }
  if (!document.querySelector('.lc-settings__pane')) return 'no Settings'
  const page = [...document.querySelectorAll('button, a')].find((b) => b.innerText.trim() === 'Appearance')
  if (!page) return 'no Appearance page'
  page.click()
  await new Promise((r) => setTimeout(r, 900))
  const row = document.querySelector('[data-setting="face-legend"]')
  if (!row) return 'no legend'
  row.scrollIntoView({ block: 'center' })
  return 'open'
})()`
const countFrames = `(() => {
  const canvas = document.querySelector('.lc-facelegend canvas')
  if (!canvas) return 'no canvas'
  const context = canvas.getContext('2d')
  if (context.__counted) return 'counting'
  const clear = context.clearRect.bind(context)
  window.__legendFrames = 0
  context.clearRect = (...rect) => { window.__legendFrames += 1; return clear(...rect) }
  context.__counted = true
  return 'counting'
})()`
const state = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
  const legend = document.querySelector('.lc-facelegend')
  const row = document.querySelector('[data-setting="face-legend"]')?.getBoundingClientRect()
  const page = document.querySelector('.lc-settings__pane')?.getBoundingClientRect()
  return {
    face: legend?.getAttribute('data-face-legend') ?? null,
    name: legend?.querySelector('.lc-facelegend__name')?.textContent ?? null,
    frames: window.__legendFrames ?? null,
    running: legend === null ? null : document.getAnimations().filter((a) => a.playState === 'running' && legend.contains(a.effect?.target ?? null)).length,
    row: row === undefined ? null : { left: row.left, top: row.top, width: row.width, height: row.height, right: row.right },
    pane: page === undefined ? null : { left: page.left, right: page.right },
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }
})())`)))
// A face the legend shows, over `seconds`: each one it showed, in order.
const watch = async (seconds) => {
  const seen = []
  for (let i = 0; i < seconds * 4; i += 1) {
    const now = (await state()).face
    if (seen.at(-1) !== now) seen.push(now)
    await sleep(250)
  }
  return seen
}

try {
  await drive.ready()
  // An automated window is not the focused one; the legend rightly holds still while unfocused (as the cover does).
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  for (const [width, height] of [[1215, 800], [860, 720]]) {
    await drive.resize(width, height)
    const opened = await drive.evaluate(openAppearance)
    check(`at ${String(width)} x ${String(height)}: Settings > Appearance shows the legend`, opened === 'open', opened)
    await drive.evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, clientY: 20 }))`)
    // Three frames of the row, a face apart.
    for (const moment of ['first', 'second', 'third']) {
      const shown = await drive.capture(`legend at ${String(width)}x${String(height)}, ${moment}`, async () => JSON.stringify(await state()))
      const read = JSON.parse(String(shown))
      check(`at ${String(width)}: the legend sits inside its line, the page not widened`, read.row !== null && read.pane !== null && read.row.right <= read.pane.right + 1 && read.overflow === false, shown)
      await sleep(2600)
    }
  }
  await drive.evaluate(countFrames)
  // Going through its faces while someone is there.
  await drive.evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 30 }))`)
  const going = await watch(8)
  check('goes through its faces, each named under it', going.length >= 3, going.join(' -> '))
  // A click shows the next.
  const before = (await state()).face
  await drive.evaluate(`document.querySelector('.lc-facelegend').click()`)
  await sleep(150)
  const after = (await state()).face
  const order = ['idle', 'thinking', 'working', 'responding', 'done', 'waiting', 'receiving', 'blocked']
  check('a click shows the next face', after === order[(order.indexOf(before) + 1) % order.length], `${String(before)} -> ${String(after)}`)
  // Behind other windows: it stops where it is, and draws nothing.
  await drive.evaluate(`window.dispatchEvent(new Event('blur'))`)
  await sleep(600)
  const resting = await state()
  await sleep(5000)
  const rested = await drive.capture('legend, the window behind others', async () => JSON.stringify(await state()))
  const behind = JSON.parse(String(rested))
  check('behind other windows: the same face, no frame drawn, nothing running', behind.face === resting.face && behind.frames === resting.frames && behind.running === 0, `${JSON.stringify(resting)} then ${rested}`)
  // In front again: it goes on.
  await drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await sleep(1200)
  const back = await state()
  check('in front again: it draws again', (back.frames ?? 0) > (behind.frames ?? 0), `${String(behind.frames)} -> ${String(back.frames)}`)
  // Reduced motion, asked for before the legend is drawn (another page of Settings, then back): still, and a click
  // still shows the next face.
  await drive.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const away = await drive.evaluate(`(async () => {
    const other = [...document.querySelectorAll('.lc-settings button, .lc-settings a')].find((b) => ['General', 'Teammates', 'Runtimes', 'Privacy'].includes(b.innerText.trim()))
    if (!other) return 'no other page'
    other.click()
    await new Promise((r) => setTimeout(r, 700))
    return document.querySelector('.lc-facelegend') === null ? 'left' : 'still there'
  })()`)
  check('reduced motion: the legend leaves with its page', away === 'left', away)
  const reopened = await drive.evaluate(openAppearance)
  check('reduced motion: Settings > Appearance opens', reopened === 'open', reopened)
  check('reduced motion is what the page now reads', (await drive.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) === true)
  await drive.evaluate(countFrames)
  await drive.evaluate(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40, clientY: 40 }))`)
  const still = await watch(6)
  const stillState = await state()
  check('reduced motion: it holds one face, drawing nothing', still.length === 1 && stillState.frames === 0 && stillState.running === 0, `${still.join(' -> ')} ${JSON.stringify(stillState)}`)
  await drive.evaluate(`document.querySelector('.lc-facelegend').click()`)
  await sleep(300)
  const clicked = await drive.capture('legend, reduced motion, clicked once', async () => JSON.stringify(await state()))
  const next = JSON.parse(String(clicked))
  check('reduced motion: a click shows the next face, drawn once, still', next.face !== stillState.face && next.frames >= 1 && next.frames <= 2, clicked)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. What a face says, Settings > Appearance: two window sizes, its faces in turn, a click, resting behind other windows and with reduced motion.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
