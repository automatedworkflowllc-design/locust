// THE THINKING DOTS, FILMED (0.613).
//
//   node _tools/probe-thinking-dots-film.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-04: the terminal faces "dont really get wonky until it goes to the two dots".
// Waits for a cover face to reach its thinking beat (two dot eyes), then copies that face's own
// canvas into a contact sheet 15 times a second for 6 s -- frames in reading order, left to right,
// row after row -- so a jump between two frames is seen, not inferred. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'dev' : 'packaged')
const OUT = join(recordRoot('thinking-dots-film'), tag)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-dots-film-ws-')
const drive = await startDrive({
  name: `thinking-dots-${tag}`, port: 9881, workspace, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
try {
  await drive.ready()
  await drive.resize(1440, 900)
  const film = String(await drive.evaluate(`(async () => {
    // Kept awake: the cover rests after 30 s untouched.
    const nudge = setInterval(() => window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5 })), 1000)
    try {
      let face
      for (let i = 0; i < 600 && !face; i += 1) {
        face = document.querySelector('.lc-cover .lc-bot[data-beat="thinking"] canvas, .lc-cover .lc-bot[data-beat="thinking-again"] canvas')
        if (!face) await new Promise((r) => setTimeout(r, 100))
      }
      if (!face) return JSON.stringify({ error: 'no cover face reached a thinking beat in 60 s', beats: [...document.querySelectorAll('.lc-cover .lc-bot')].map((b) => b.dataset.beat) })
      const cell = 120
      const columns = 15
      const frames = 90
      const sheet = document.createElement('canvas')
      sheet.width = cell * columns
      sheet.height = cell * Math.ceil(frames / columns)
      const ctx = sheet.getContext('2d')
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, sheet.width, sheet.height)
      const beats = []
      for (let n = 0; n < frames; n += 1) {
        await new Promise((r) => setTimeout(r, 1000 / 15))
        ctx.drawImage(face, (n % columns) * cell, Math.floor(n / columns) * cell, cell, cell)
        beats.push(face.closest('.lc-bot')?.dataset.beat ?? '?')
      }
      return JSON.stringify({ png: sheet.toDataURL('image/png'), beats: [...new Set(beats)] })
    } finally {
      clearInterval(nudge)
    }
  })()`))
  const result = JSON.parse(film)
  if (result.error) say(`  ${result.error} ${JSON.stringify(result.beats)}`)
  else {
    await writeFile(join(OUT, 'thinking-dots.png'), Buffer.from(result.png.replace(/^data:image\/png;base64,/, ''), 'base64'))
    say(`  filmed 90 frames at 15 a second; beats seen: ${JSON.stringify(result.beats)}; ${join(OUT, 'thinking-dots.png')}`)
  }
} catch (error) {
  say(`  probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The thinking dots, filmed.`, extra: '' })
}
