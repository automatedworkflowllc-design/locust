// Does the New teammate dialog fit in the window?
//
//   node _tools/drive-new-teammate-fit.mjs [--label before|after] [--packaged <exe>]
//
// Colin, 2026-09-22: "its folding under the app again, when i hit new
// teammate, on the plus sign". Opens the dialog from the sidebar's "+" the
// way he does, at the drive's own size, the smallest window allowed and a
// short laptop window, and measures the dialog and its Create button against
// the window. Sends nothing, makes nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const label = arg('--label') ?? 'after'
const packaged = arg('--packaged')
const OUT = join(recordRoot('new-teammate-fit-2026-09-22'), label)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-newmate-ws-')
const drive = await startDrive({
  name: `new-teammate-fit-${label}`,
  port: 9398,
  workspace,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const OPEN = `(async () => {
  document.querySelector('.lc-dialog__close')?.click()
  await new Promise(r => setTimeout(r, 300))
  const add = [...document.querySelectorAll('button[aria-label="Add"]')].find((b) => b.getBoundingClientRect().width > 0)
  if (!add) return JSON.stringify({ error: 'no + button' })
  add.click()
  await new Promise(r => setTimeout(r, 300))
  const item = [...document.querySelectorAll('[role="menuitem"], .lc-menu__item')].find((b) => /New teammate/.test(b.textContent))
  if (!item) return JSON.stringify({ error: 'no New teammate item' })
  item.click()
  await new Promise(r => setTimeout(r, 600))
  const dialog = document.querySelector('.lc-dialog[role="dialog"]')
  if (!dialog) return JSON.stringify({ error: 'no dialog' })
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) } }
  const create = [...dialog.querySelectorAll('.lc-dialog__foot button')].pop()
  const head = dialog.querySelector('.lc-dialog__head')
  const body = dialog.querySelector('.lc-dialog__body')
  return JSON.stringify({
    window: { width: window.innerWidth, height: window.innerHeight },
    dialog: box(dialog),
    head: head ? box(head) : null,
    create: create ? { ...box(create), text: create.textContent.trim() } : null,
    body: body ? { scrolls: body.scrollHeight > body.clientHeight + 1, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null
  })
})()`

try {
  await drive.ready()
  for (const [name, size] of [['drive', undefined], ['1120x720', [1120, 720]], ['1280x640', [1280, 640]]]) {
    if (size !== undefined) {
      await drive.resize(size[0], size[1])
      await sleep(700)
    }
    const m = JSON.parse(await drive.evaluate(OPEN))
    if (m.error) {
      check(`${name}: the dialog opens from the +`, false, m.error)
      continue
    }
    say(`${name}: window ${m.window.width}x${m.window.height}; dialog ${m.dialog.top}..${m.dialog.bottom}; head top ${m.head?.top}; "${m.create?.text}" ${m.create?.top}..${m.create?.bottom}; body scrolls ${m.body?.scrolls}`)
    check(`${name}: the dialog's head is on screen, below the title bar`, (m.head?.top ?? -1) >= 38, `head top ${m.head?.top}`)
    check(`${name}: the Create button is on screen`, (m.create?.bottom ?? 1e9) <= m.window.height, `button bottom ${m.create?.bottom} of ${m.window.height}`)
    const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) await writeFile(join(OUT, `${name}.png`), Buffer.from(shot.result.data, 'base64'))
  }
  say(failures === 0 ? '\nNEW TEAMMATE FIT PASSED' : `\nNEW TEAMMATE FIT: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The New teammate dialog, measured against the window.' })
}
