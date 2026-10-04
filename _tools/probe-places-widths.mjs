// Measures the sidebar's places bar: each button's natural width against the row (0.526).
//
//   node _tools/probe-places-widths.mjs [--packaged <exe>]
//
// "Conversations" is the longest word the bar has held. Says whether every
// icon and label is shown whole, at three window sizes.

import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'probe-places-widths',
  port: 9848,
  sendsNothing: true,
  outPath: join(recordRoot('probe-places-widths-2026-10-01'), 'local')
})
const MEASURE = `(() => {
  const row = document.querySelector('.lc-sidebar__places:not(.lc-sidebar__places--pinned)')
  if (!row) return 'no places bar'
  const cs = getComputedStyle(row)
  const inner = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const parts = [...row.querySelectorAll('button')].map((b) => {
    const span = b.querySelector('span'); const icon = b.querySelector('svg')
    const iconBox = icon?.getBoundingClientRect(); const box = b.getBoundingClientRect()
    return { label: span?.innerText ?? '', button: Math.round(box.width), text: span?.scrollWidth ?? 0, clipped: span ? span.scrollWidth > span.clientWidth : false, iconShown: iconBox ? iconBox.width > 0 && iconBox.left >= box.left - 0.5 : false }
  })
  return JSON.stringify({ inner: Math.round(inner), parts })
})()`
let failures = 0
try {
  await drive.ready()
  for (const [w, h] of [[1209, 770], [1440, 900], [1024, 700]]) {
    await drive.resize(w, h)
    await sleep(900)
    const got = String(await drive.capture(`places bar at ${String(w)}x${String(h)}`, () => drive.evaluate(MEASURE)))
    const whole = !/"clipped":true|"iconShown":false/.test(got)
    if (!whole) failures += 1
    say(`  [${whole ? 'PASS' : 'FAIL'}] ${String(w)}x${String(h)} every icon and label whole -- ${got}`)
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The places bar, measured.`, extra: `Checks failed: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
