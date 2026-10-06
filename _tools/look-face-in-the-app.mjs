// A working teammate's faces IN THE APP, filmed: the conversation header's and the sidebar's (2026-10-06).
//
//   node _tools/look-face-in-the-app.mjs --packaged <exe> --out <folder> [--frames 40] [--every 33] [--busy 0]
//
// Colin, 2026-10-06, watching a sweep's window: "wrens eyes are violently shaking in the top and side bar".
// look-eyes-moving films the bots on a page of their own, on a clock it steps itself, and found them smooth;
// this films them where he saw them -- the packaged app, Wren at work on a free model (spends nothing),
// screenshots of each face's own box as fast as the window gives them. `--busy N` runs N loops that keep a
// core each busy meanwhile, as a sweep beside it does. Writes each face's frames as PNGs, a strip per face,
// and how many pixels changed from each frame to the next (a shake is a big change that comes back).

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const packaged = arg('--packaged')
const out = arg('--out')
if (out === undefined) throw new Error('--out <folder> is required')
const frames = Number(arg('--frames', '40'))
const every = Number(arg('--every', '33'))
const busy = Number(arg('--busy', '0'))
await mkdir(out, { recursive: true })

const loops = Array.from({ length: busy }, () => new Worker('for (;;) {}', { eval: true }))
const workspace = await scratchRepository('locust-look-face-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'look-face-in-the-app', port: 9871, workspace, sendsNothing: false,
  outPath: join(out, 'session'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-05T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
try {
  await drive.ready()
  await drive.resize(1220, 800)
  say(String(await drive.evaluate(openTeammateScript('Wren'))))
  await drive.evaluate(`(() => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Write a 600-word story about a lighthouse keeper. Plain prose.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    setTimeout(() => document.querySelector('button[aria-label="Send"]')?.click(), 400)
  })()`)
  await sleep(6000)
  const boxes = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return {
      header: box(document.querySelector('.lc-workroom__identity canvas, .lc-workroom__identity svg')),
      sidebar: box([...document.querySelectorAll('.lc-faces__one')].map((one) => one.querySelector('canvas, svg')).find(Boolean)),
      activity: document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 120) ?? ''
    }
  })())`)))
  say(`faces: ${JSON.stringify(boxes)}`)
  for (const name of ['header', 'sidebar']) {
    const box = boxes[name]
    if (box === null) { say(`no ${name} face`); continue }
    const shots = []
    for (let i = 0; i < frames; i += 1) {
      const started = Date.now()
      const shot = await drive.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 4 }, fromSurface: true })
      shots.push(Buffer.from(shot.result.data, 'base64'))
      const left = every - (Date.now() - started)
      if (left > 0) await sleep(left)
    }
    for (let i = 0; i < shots.length; i += 1) await writeFile(join(out, `${name}-${String(i).padStart(2, '0')}.png`), shots[i])
    say(`${name}: ${String(shots.length)} frames`)
  }
} finally {
  for (const loop of loops) void loop.terminate()
  await drive.finish({ intro: 'look-face-in-the-app', extra: '' })
}
