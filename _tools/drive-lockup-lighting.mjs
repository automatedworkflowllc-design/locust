// When does the home lockup light, and does it come back?
//
//   node _tools/drive-lockup-lighting.mjs [--tube full|subtle|off] [--packaged <exe>]
//
// Colin, 2026-09-22: the design system cover's power-on "where our current
// logo goes ... make sure it starts playing after the probing process, and
// maybe run that weird green crt effect every 7-10 seconds". This launches
// the app with its loading screen, watches the home screen from the first
// moment, and reports when the runtimes answered, when the window came into
// focus, when the lockup first lit, and when it lit again -- with frames of
// the lighting. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const tube = arg('--tube') ?? 'full'
const packaged = arg('--packaged')
const OUT = join(new URL('../docs/lockup-lighting-2026-09-22/', import.meta.url).pathname.slice(1), tube)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-lockup-ws-')
const drive = await startDrive({
  name: `lockup-lighting-${tube}`,
  port: 9391,
  workspace,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, tube }
  }
})

const shoot = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}

try {
  // Watch from the first moment, before anything else happens.
  await drive.evaluate(`(() => {
    const log = []
    const t0 = performance.now()
    let last = ''
    const tick = () => {
      const lockup = document.querySelector('.lc-lockup')
      const state = [
        document.hasFocus() ? 'focus' : 'nofocus',
        document.querySelector('.lc-intro') ? 'ready' : 'probing',
        lockup ? (lockup.className.match(/is-(powering|relighting)/)?.[0] ?? 'still') : 'nolockup'
      ].join(' ')
      if (state !== last) { log.push(Math.round(performance.now() - t0) + ' ' + state); last = state }
    }
    window.__lockupLog = log
    window.__lockupTimer = setInterval(tick, 30)
    tick()
    return 'watching'
  })()`)

  // Frames of the first lighting, taken as it happens.
  let shotPower = false
  let shotRelight = false
  for (let i = 0; i < (tube === "full" ? 700 : 400); i += 1) {
    await sleep(30)
    const cls = await drive.evaluate(`document.querySelector('.lc-lockup')?.className ?? ''`)
    if (!shotPower && /is-powering/.test(cls ?? '')) {
      shotPower = true
      await sleep(450); await shoot('01-lit.png')
      await sleep(600); await shoot('02-sweep.png')
      await sleep(1900); await shoot('03-settled.png')
    }
    if (shotPower && !shotRelight && /is-relighting/.test(cls ?? '')) {
      shotRelight = true
      await sleep(500); await shoot('04-relit.png')
    }
    if (shotRelight) break
  }
  await sleep(1500)
  const log = await drive.evaluate(`(clearInterval(window.__lockupTimer), JSON.stringify(window.__lockupLog))`)
  say(`timeline (ms from the watch starting, state = focus / probing / lighting):`)
  for (const line of JSON.parse(log ?? '[]')) say(`   ${line}`)
  await writeFile(join(OUT, 'timeline.json'), log ?? '[]', 'utf8')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Lockup lighting, tube ${tube}.` })
}
