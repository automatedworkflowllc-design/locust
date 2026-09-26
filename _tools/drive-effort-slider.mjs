// The effort control: Claude Code's layout on the gooey slider, photographed.
//
//   node _tools/drive-effort-slider.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23: "handle the gooey slider idea with exact same type as
// Claude code fit to our Ui". Picks Claude Code's Opus 5.5 (five levels) --
// picking a route sends nothing -- opens the effort panel, and photographs it
// at rest and through one step, frame by frame, to see the liquid pour from
// stop to stop. Checks the words, the stops, and that the step lands where
// the control says. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(recordRoot('effort-slider-2026-09-23'), tag)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: 'effort-slider',
  port: 9409,
  workspace: await scratchRepository('locust-drive-effort-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const shootPanel = async (file) => {
  const box = JSON.parse(await drive.evaluate(`JSON.stringify(document.querySelector('.lc-effortpanel').getBoundingClientRect())`))
  const shot = await drive.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24, scale: 3 } })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
const PANEL = `(() => {
  const panel = document.querySelector('.lc-effortpanel')
  if (!panel) return JSON.stringify(null)
  const input = panel.querySelector('.lc-effortpanel__slider')
  const thumb = panel.querySelector('.lc-effortpanel__thumb')
  const scale = panel.querySelector('.lc-effortpanel__scale').getBoundingClientRect()
  const notches = [...panel.querySelectorAll('.lc-effortpanel__notch')].map((n) => { const r = n.getBoundingClientRect(); return Math.round(r.left + r.width / 2 - scale.left) })
  const t = thumb.getBoundingClientRect()
  return JSON.stringify({
    label: panel.querySelector('.lc-effortpanel__label')?.innerText ?? '',
    now: panel.querySelector('.lc-effortpanel__now')?.innerText ?? '',
    ends: panel.querySelector('.lc-effortpanel__ends')?.innerText.replace(/\\s+/g, ' ') ?? '',
    help: panel.querySelector('.lc-effortpanel__what')?.getAttribute('title') ?? '',
    value: input.value,
    max: input.max,
    notches,
    thumbCentre: Math.round(t.left + t.width / 2 - scale.left),
    chip: document.querySelector('.lc-composer__controls button[aria-label="Reasoning effort"]')?.innerText.trim() ?? ''
  })
})()`

try {
  await drive.ready()
  await drive.resize(1120, 720)
  say(await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'opus', row: '/opus 5\\.5/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  say(`route: ${route}`)
  const opened = await drive.evaluate(`(async () => {
    const chip = document.querySelector('.lc-composer__controls button[aria-label="Reasoning effort"]')
    if (!chip || chip.disabled) return 'no effort chip'
    chip.click()
    await new Promise((r) => setTimeout(r, 500))
    return document.querySelector('.lc-effortpanel') ? 'open' : 'did not open'
  })()`)
  check('the effort chip opens the panel', opened === 'open', opened)
  const rest = JSON.parse(await drive.evaluate(PANEL))
  say(`at rest: ${JSON.stringify(rest)}`)
  check('it reads as Claude Code’s: "Effort", the level in words, Faster and Smarter, a ?', rest.label === 'Effort' && /^[A-Z]/.test(rest.now) && rest.ends === 'Faster Smarter' && rest.help.length > 0, JSON.stringify({ label: rest.label, now: rest.now, ends: rest.ends }))
  check('a stop for every level the model has, and the thumb on its own', rest.notches.length === Number(rest.max) + 1 && Math.abs(rest.thumbCentre - rest.notches[Number(rest.value)]) <= 2, `${String(rest.notches.length)} stops; thumb ${String(rest.thumbCentre)} vs stop ${String(rest.notches[Number(rest.value)])}`)
  await shootPanel('01-rest.png')

  // One step toward Faster, set the way a person's drag sets it: on the input.
  const target = Math.max(0, Number(rest.value) - 2)
  await drive.evaluate(`(() => {
    const input = document.querySelector('.lc-effortpanel__slider')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, '${String(target)}')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return 'stepped'
  })()`)
  for (let frame = 0; frame < 8; frame += 1) {
    await shootPanel(`02-step-${String(frame).padStart(2, '0')}.png`)
    await sleep(45)
  }
  await sleep(900)
  const after = JSON.parse(await drive.evaluate(PANEL))
  say(`after the step: ${JSON.stringify(after)}`)
  check('the step lands: the value, the name, the thumb and the chip agree', Number(after.value) === target && Math.abs(after.thumbCentre - after.notches[target]) <= 2 && after.chip.startsWith(after.now.split(' · ')[0]), JSON.stringify({ value: after.value, now: after.now, chip: after.chip }))
  await shootPanel('03-settled.png')
  say(failures === 0 ? '\nEFFORT SLIDER PASSED' : `\nEFFORT SLIDER: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The effort control, Claude Code’s on the gooey slider. Sends nothing.' })
}
