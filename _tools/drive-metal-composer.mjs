// The metal composer: libraries.dev's chatbox with Colin's moves, photographed.
//
//   node _tools/drive-metal-composer.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23: "i wanted those same drop downs and chat box as well, the
// exact thing besides the additions i told you" -- "just put effort and agent
// next to each other, and the (auto) box next to the +". At 1120x720 and
// 1920x1080: the box at rest, with text, each dropdown open, the + menu open,
// and the stop while a run goes; the row's order and fit are checked, and what
// the idle composer costs is measured. One free OpenCode message.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('metal-composer-2026-09-23'), tag)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: 'metal-composer',
  port: 9408,
  workspace: await scratchRepository('locust-drive-metal-ws-'),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_yurt', name: 'Yurt', hue: 'pearl', role: 'Code & Migrations', avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'ghost', face: 'eyes' } }, createdAt: '2026-09-23T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const shootBox = async (file, extraTop = 0) => {
  const box = JSON.parse(await drive.evaluate(`JSON.stringify(document.querySelector('.lc-composer__box').getBoundingClientRect())`))
  const shot = await drive.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x - 24, y: box.y - 24 - extraTop, width: box.width + 48, height: box.height + 48 + extraTop, scale: 2 } })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
const shootWindow = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
// The row, left to right, by what each control is -- and whether it is ONE
// line (Colin's frame of the first cut had it wrapped onto two).
const ROW = `(() => {
  const row = document.querySelector('.lc-composer__box .lc-composer__controls')
  if (!row) return JSON.stringify({ inside: false })
  const name = (el) => {
    if (el.getAttribute('aria-haspopup') === 'listbox') return 'route'
    if (el.getAttribute('aria-label') === 'Reasoning effort' || el.classList.contains('is-static')) return 'effort'
    if (el.getAttribute('aria-label') === 'Permission mode') return 'mode'
    if (el.classList.contains('lc-plusmenu__main')) return 'plus'
    if (el.getAttribute('aria-label') === 'Send') return 'send'
    return el.getAttribute('aria-label') || el.className.split(' ').find((c) => c.startsWith('lc-')) || el.tagName
  }
  const items = [...row.querySelectorAll('button, .lc-composer__context, .lc-control.is-static')].filter((el) => el.getBoundingClientRect().width > 0 && !el.closest('.lc-menu') && !el.classList.contains('lc-plusmenu__satellite'))
  const box = document.querySelector('.lc-composer__box').getBoundingClientRect()
  const centres = items.map((el) => el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)
  return JSON.stringify({
    inside: true,
    order: items.map(name),
    heights: items.map((el) => Math.round(el.getBoundingClientRect().height)),
    oneLine: Math.max(...centres) - Math.min(...centres) < 2,
    overflow: items.some((el) => el.getBoundingClientRect().right > box.right - 8 || el.getBoundingClientRect().left < box.left + 8),
    top: box.top,
    bottom: box.bottom
  })
})()`

try {
  await drive.ready()
  for (const [width, height] of [[1120, 720], [1920, 1080]]) {
    await drive.resize(width, height)
    await sleep(500)
    const row = JSON.parse(await drive.evaluate(ROW))
    say(`${String(width)}x${String(height)}: ${JSON.stringify(row)}`)
    const order = (row.order ?? []).filter((entry) => entry !== 'lc-composer__context')
    check(`${String(width)}: the row sits inside the box, on one line`, row.inside === true && row.oneLine === true, JSON.stringify(row.heights))
    // 0.451.0 (CHANGELOG.md, 2026-09-28): "Direct, Compare or Blind, in the message box. A chip beside the
    // permission mode picks how you ask ... It replaces the switch inside the model picker." The chip sits between the +
    // and the mode (Composer.tsx: the `Chat mode: ...` button), so the mode is no longer the + 's neighbour: it follows the chip.
    const modeAt = order.indexOf('mode')
    check(`${String(width)}: the + first, the chat mode chip, then the mode`, order[0] === 'plus' && (modeAt === 1 || (modeAt === 2 && /^Chat mode: /.test(order[1] ?? ''))), order.join(' | '))
    check(`${String(width)}: the route and the effort together, the send last`, order.indexOf('effort') === order.indexOf('route') + 1 && order[order.length - 1] === 'send', order.join(' | '))
    check(`${String(width)}: nothing past the box's edge`, row.overflow === false)
    check(`${String(width)}: the box is on screen`, row.bottom <= height, `${String(Math.round(row.bottom))} of ${String(height)}`)
    await shootBox(`01-rest-${String(width)}.png`)
    await shootWindow(`00-window-${String(width)}.png`)
  }
  await drive.resize(1120, 720)
  // Text, so Send is live.
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(field, 'Read README.md and LOCUST.md, list the files here, then describe this project in three sentences.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return 'typed'
  })()`)
  await shootBox('02-with-text.png')
  // The gooey +, open: the satellites out, the + turned to a cross.
  await drive.evaluate(`(document.querySelector('.lc-plusmenu__main').click(), 'opened')`)
  await sleep(900)
  const menu = JSON.parse(await drive.evaluate(`JSON.stringify({ open: !!document.querySelector('.lc-plusmenu.is-open'), satellites: [...document.querySelectorAll('.lc-plusmenu__satellite')].map((b) => ({ key: b.getAttribute('data-satellite'), shown: getComputedStyle(b.querySelector('.lc-plusmenu__icon')).opacity })) })`))
  check('the + opens into its satellites, Attach files and Choose a folder, icons shown', menu.open && menu.satellites.length === 2 && menu.satellites.every((s) => Number(s.shown) > 0.9), JSON.stringify(menu))
  await shootBox('02b-plus-open.png', 110)
  await drive.evaluate(`(document.querySelector('.lc-plusmenu__main').click(), 'closed')`)
  await sleep(900)
  check('and folds back', !(await drive.evaluate(`!!document.querySelector('.lc-plusmenu.is-open')`)))
  // Each dropdown, open.
  for (const [label, selector, file] of [
    ['Permission mode', '.lc-composer__controls button[aria-label="Permission mode"]', '03-mode-open.png'],
    ['Reasoning effort', '.lc-composer__controls button[aria-label="Reasoning effort"]', '05-effort-open.png']
  ]) {
    const opened = await drive.evaluate(`(async () => {
      const button = document.querySelector('${selector}')
      if (!button || button.disabled) return 'not there'
      button.click()
      await new Promise((r) => setTimeout(r, 350))
      return 'open'
    })()`)
    say(`${label}: ${opened}`)
    if (opened === 'open') {
      await shootBox(file, 320)
      await drive.evaluate(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), document.body.click(), 'closed')`)
      await sleep(250)
    }
  }
  await drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.lc-composer__controls .lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    button.click()
    await new Promise((r) => setTimeout(r, 450))
    return 'open'
  })()`)
  await shootWindow('04-route-open.png')
  await drive.evaluate(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')`)
  await sleep(300)

  // What the composer costs at rest: the metal sleeps until hovered.
  await drive.send('Performance.enable')
  const metric = async () => (await drive.send('Performance.getMetrics'))?.result?.metrics?.find((entry) => entry.name === 'TaskDuration')?.value ?? 0
  const t0 = await metric()
  await sleep(5000)
  const t1 = await metric()
  say(`renderer busy with the composer at rest: ${(((t1 - t0) / 5) * 100).toFixed(1)}%`)

  // The stop, while a run goes.
  say(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  await drive.evaluate(`(document.querySelector('button[aria-label="Send"]').click(), 'sent')`)
  await drive.waitFor(`!!document.querySelector('button[aria-label="Stop the running reply"]')`, { timeoutMs: 30_000, what: 'the stop button' })
  await sleep(1200)
  await shootBox('06-running.png')
  await shootWindow('07-window-running.png')
  await drive.waitFor(`!document.querySelector('button[aria-label="Stop the running reply"]')`, { timeoutMs: 150_000, everyMs: 1000, what: 'the run to finish' })
  await shootWindow('08-window-after.png')
  say(failures === 0 ? '\nMETAL COMPOSER PASSED' : `\nMETAL COMPOSER: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "The metal composer. One free OpenCode message." })
}
