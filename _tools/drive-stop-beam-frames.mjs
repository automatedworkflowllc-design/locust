// The stop button's beam, frame by frame -- is it visible?
//
//   node _tools/drive-stop-beam-frames.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23: "slightly raise the intensity for the current mono beam,
// its not too visible rn". A beam travels, so one photograph proves nothing
// either way: this takes twelve of the stop button, 160 ms apart, at four
// times scale, and a contact sheet of them. One free OpenCode message.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('composer-buttons-2026-09-23'), `beam-${tag}`)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: 'stop-beam-frames',
  port: 9407,
  workspace: await scratchRepository('locust-drive-stopbeam-ws-'),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

try {
  await drive.ready()
  await drive.resize(1120, 720)
  say(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(field, 'Read README.md and LOCUST.md, list the files here, then describe this project in three sentences.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    document.querySelector('button[aria-label="Start mission"]').click()
    return 'sent'
  })()`)
  await drive.waitFor(`!!document.querySelector('.lc-stopbeam button[aria-label="Stop the running mission"]')`, { timeoutMs: 30_000, what: 'the stop button' })
  await sleep(900)
  const box = JSON.parse(await drive.evaluate(`JSON.stringify(document.querySelector('.lc-stopbeam').getBoundingClientRect())`))
  for (let frame = 0; frame < 12; frame += 1) {
    const shot = await drive.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16, scale: 4 } })
    if (shot?.result?.data) await writeFile(join(OUT, `frame-${String(frame).padStart(2, '0')}.png`), Buffer.from(shot.result.data, 'base64'))
    await sleep(160)
  }
  say('\nFRAMES TAKEN')
  await drive.waitFor(`!document.querySelector('.lc-stopbeam')`, { timeoutMs: 150_000, everyMs: 1000, what: 'the run to finish' })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "The stop button's beam, frame by frame. One free OpenCode message." })
}
