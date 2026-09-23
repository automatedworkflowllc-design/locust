// Frames of the home cover, for a design review before anything ships.
//
//   node _tools/cover-sample-frames.mjs --out <folder> [--packaged <exe>]
//
// The home screen at 1215x800 and 1120x720, the cover alone at 3x, and the
// lockup lighting frame by frame. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = arg('--out')
if (OUT === undefined) throw new Error('--out <folder> is required')
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: 'cover-sample',
  port: 9431,
  workspace: await scratchRepository('locust-cover-sample-ws-'),
  sendsNothing: true,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Custom', createdAt: '2026-09-05T05:00:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const shoot = async (file, clip) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png', ...(clip === undefined ? {} : { clip }) })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
const coverBox = async (pad = 24) => {
  const box = JSON.parse(await drive.evaluate(`JSON.stringify(document.querySelector('.lc-cover')?.getBoundingClientRect() ?? null)`))
  return box === null ? undefined : { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale: 3 }
}

try {
  await drive.resize(1215, 800)
  // The lighting runs once the runtimes answer; catch it as it happens.
  for (let frame = 0; frame < 40; frame += 1) {
    const lit = await drive.evaluate(`document.querySelector('.lc-lockup.is-powering') ? 'powering' : document.querySelector('.lc-cover') ? 'cover' : 'none'`)
    if (lit === 'powering') {
      for (let step = 0; step < 8; step += 1) {
        const clip = await coverBox(8)
        if (clip !== undefined) await shoot(`lighting-${String(step).padStart(2, '0')}.png`, { ...clip, scale: 1.5 })
        await sleep(300)
      }
      break
    }
    await sleep(250)
  }
  await drive.ready()
  await sleep(3500)
  await shoot('home-1215x800.png')
  const clip = await coverBox()
  if (clip !== undefined) await shoot('cover-3x.png', clip)
  await drive.resize(1120, 720)
  await sleep(1200)
  await shoot('home-1120x720.png')
  // Whether it fits is first-screen-fits.mjs's to say; this only photographs.
} catch (error) {
  say(`frames failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The home cover, for review. Nothing was sent.' })
}
