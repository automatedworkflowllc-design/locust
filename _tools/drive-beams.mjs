// The mono beams: round the title box while the runtimes are being found, and
// round the stop button while a run goes -- photographed, and what they cost.
//
//   node _tools/drive-beams.mjs [--packaged <exe>]
//
// Colin, 2026-09-23, on libraries.dev/beam: "a loading hue for their stop
// button ... make it mono instead to make it subtle", and "a rotate large
// mono around the title box with the logo in it" -- and then, having seen the
// title's run beside the bots: "it just makes it look like something is
// loading that isnt loading". So the title's beam is checked twice: running
// while discovery runs (the bots still), and out once the lockup lights.
// One message on the free OpenCode route, to have a stop button to look at.
// Spends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(new URL('../docs/beams-2026-09-23/', import.meta.url).pathname.slice(1), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-beams-ws-')
const drive = await startDrive({
  name: 'beams',
  port: 9400,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const clip = async (file, selector, pad = 24) => {
  const box = JSON.parse(await drive.evaluate(`(() => { const r = document.querySelector('${selector}')?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null) })()`))
  const shot = await drive.send('Page.captureScreenshot', {
    format: 'png',
    ...(box === null ? {} : { clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2, scale: selector.includes('stop') ? 3 : 1 } })
  })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}
const beamAnimations = (selector) => `(() => {
  const wrap = document.querySelector('${selector}')
  if (!wrap) return JSON.stringify([])
  return JSON.stringify(document.getAnimations().filter((a) => {
    const target = a.effect && a.effect.target
    return target && (target === wrap || wrap.contains(target))
  }).map((a) => ({ name: a.animationName || a.id || 'anim', pseudo: a.effect.pseudoElement || '', state: a.playState, duration: a.effect.getTiming().duration })))
})()`
const metric = async () => {
  const result = await drive.send('Performance.getMetrics')
  return result?.result?.metrics?.find((entry) => entry.name === 'TaskDuration')?.value ?? 0
}

// The cover's own word for whether discovery is done: its bots are drawn
// still, as `data-state="still"`, until the runtimes have answered.
const LOADING = `!!document.querySelector('.lc-cover .lc-bot[data-state="still"]')`

try {
  // BEFORE drive.ready(), which waits for discovery to finish: the beam is
  // meant to be seen while it has not.
  await drive.waitFor(`!!document.querySelector('.lc-coverbeam')`, { timeoutMs: 30_000, what: 'the home screen' })
  // Give it the moment to come on, and say so if the loading ended first.
  // (It does not wait for the window's focus, which a drive's window may
  // never get: 0.279's first try did, and never lit here.)
  const firstLook = await drive.waitFor(`(() => {
    const wrap = document.querySelector('.lc-coverbeam')
    if (!(${LOADING})) return 'loading over; focused ' + document.hasFocus()
    return wrap && wrap.hasAttribute('data-active') ? 'beam on' : false
  })()`, { timeoutMs: 30_000, everyMs: 100, what: 'the beam to come on, or the loading to end' })
  say(`first look: ${firstLook}`)
  if (firstLook === 'beam on') {
    await sleep(700)
    const whileLoading = JSON.parse(await drive.evaluate(beamAnimations('.lc-coverbeam')))
    const stillLoading = await drive.evaluate(LOADING)
    say(`while the runtimes are being found (${stillLoading ? 'still' : 'no longer'} loading): ${JSON.stringify(whileLoading)}`)
    check('while the runtimes are being found, the title box wears a travelling beam', whileLoading.some((a) => a.name.startsWith('beam-spin') && a.state === 'running'), JSON.stringify(whileLoading))
    await clip('title-loading.png', '.lc-coverbeam', 16)
  } else {
    check('the beam came on while the runtimes were still being found', false, firstLook)
  }
  await drive.ready()
  await drive.waitFor(`!document.querySelector('.lc-cover .lc-bot[data-state="still"]')`, { timeoutMs: 40_000, what: 'the lockup to light' })
  await drive.waitFor(`!!document.querySelector('.lc-intro')`, { timeoutMs: 40_000, what: 'probing done' })
  await sleep(4000)
  const cover = JSON.parse(await drive.evaluate(`(() => {
    const wrap = document.querySelector('.lc-coverbeam')
    if (!wrap) return JSON.stringify({ wrap: false })
    const after = getComputedStyle(wrap, '::after')
    return JSON.stringify({ wrap: true, attrs: [...wrap.attributes].map((a) => a.name).join(','), afterAnim: after.animationName, afterOpacity: after.opacity, width: Math.round(wrap.getBoundingClientRect().width), card: Math.round(document.querySelector('.lc-cover').getBoundingClientRect().width) })
  })()`))
  say(`title box beam: ${JSON.stringify(cover)}`)
  const coverAnims = JSON.parse(await drive.evaluate(beamAnimations('.lc-coverbeam')))
  say(`running in the title box beam: ${JSON.stringify(coverAnims)}`)
  // The bots' own float and ring run inside the same box; the beam's are
  // the package's `beam-*` animations.
  const beamStillGoing = coverAnims.filter((a) => a.name.startsWith('beam-') && a.state === 'running')
  check('once the lockup lights and the bots move, the beam is out', cover.wrap && beamStillGoing.length === 0 && !/data-active/.test(cover.attrs), `${JSON.stringify(beamStillGoing)}; ${cover.attrs}`)
  check("the box keeps the card's whole width", cover.width === cover.card, `${cover.width} vs ${cover.card}`)
  await clip('title-ready.png', '.lc-coverbeam', 16)
  await drive.send('Performance.enable')
  const a = await metric()
  await sleep(5000)
  const b = await metric()
  say(`renderer busy on the home screen, the bots and no beam: ${(((b - a) / 5) * 100).toFixed(1)}% (0.278 measured about 18% with the beam)`)

  // A run, to have a stop button.
  say(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
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
  await drive.waitFor(`!!document.querySelector('.lc-stopbeam button[aria-label="Stop the running mission"]')`, { timeoutMs: 30_000, what: 'the stop button' })
  await sleep(1200)
  const stop = JSON.parse(await drive.evaluate(`(() => {
    const wrap = document.querySelector('.lc-stopbeam')
    const after = getComputedStyle(wrap, '::after')
    const button = wrap.querySelector('button').getBoundingClientRect()
    const box = wrap.getBoundingClientRect()
    return JSON.stringify({ afterAnim: after.animationName, button: [Math.round(button.width), Math.round(button.height)], wrap: [Math.round(box.width), Math.round(box.height)] })
  })()`))
  say(`stop button beam: ${JSON.stringify(stop)}`)
  const stopAnims = JSON.parse(await drive.evaluate(beamAnimations('.lc-stopbeam')))
  say(`running in the stop button beam: ${JSON.stringify(stopAnims)}`)
  check('the stop button wears a travelling beam while the run goes', stopAnims.some((a) => a.state === 'running'), JSON.stringify(stopAnims))
  check('the beam does not move the button', stop.button.join() === stop.wrap.join(), `${stop.button} in ${stop.wrap}`)
  for (const [index, wait] of [[1, 0], [2, 400], [3, 400]]) {
    await sleep(wait)
    await clip(`stop-${String(index)}.png`, '.lc-stopbeam', 10)
  }
  await drive.waitFor(`!document.querySelector('.lc-stopbeam')`, { timeoutMs: 120_000, everyMs: 1000, what: 'the run to finish' })
  check('the beam goes when the run ends', true)
  say(failures === 0 ? '\nBEAMS PASSED' : `\nBEAMS: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The mono beams. One free OpenCode message.' })
}
