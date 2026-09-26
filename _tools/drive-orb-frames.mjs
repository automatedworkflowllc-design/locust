// The live line's orb, photographed during a real run, for a before/after.
//
//   node _tools/drive-orb-frames.mjs --label main|branch
//
// One message on the free OpenCode route. While it runs, the live line's orb
// is polled; each time it shows a density shape, the canvas's own size is
// recorded (the library's canvas is 64 backing pixels, the painted-down one
// is 26) and the screen is photographed. Crops are made from those frames
// afterwards. Spends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const label = arg('--label') ?? 'main'
const OUT = join(recordRoot('orb-frames-2026-09-22'), label)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-orbframes-ws-')
const drive = await startDrive({
  name: `orb-frames-${label}`,
  port: 9395,
  workspace,
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

const DENSE = ['composing', 'listening', 'solving', 'searching', 'connecting', 'weaving']
try {
  await drive.ready()
  say(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(field, 'Read README.md and LOCUST.md, then describe this project in three sentences.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    document.querySelector('button[aria-label="Start mission"]')?.click()
    return 'sent'
  })()`)
  const seen = []
  let shots = 0
  for (let i = 0; i < 600 && shots < 4; i += 1) {
    await sleep(150)
    const orb = await drive.evaluate(`(() => {
      const holder = document.querySelector('.lc-livestep__orb')
      const canvas = holder?.querySelector('canvas')
      if (!holder || !canvas) return null
      const box = canvas.getBoundingClientRect()
      return JSON.stringify({ state: holder.getAttribute('data-orb'), backing: canvas.width, css: Math.round(box.width), x: Math.round(box.left), y: Math.round(box.top) })
    })()`)
    if (!orb) continue
    const info = JSON.parse(orb)
    const key = info.state + ' ' + info.backing
    if (seen[seen.length - 1] !== key) seen.push(key)
    if (DENSE.includes(info.state) && i % 4 === 0) {
      shots += 1
      const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(OUT, `orb-${String(shots)}.png`), Buffer.from(shot.result.data, 'base64'))
      await writeFile(join(OUT, `orb-${String(shots)}.json`), JSON.stringify(info), 'utf8')
    }
  }
  say(`orb states seen (state backing-pixels): ${seen.join(' -> ')}`)
  say(`photographs: ${String(shots)}`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Orb frames, ${label}. One free OpenCode message.` })
}
