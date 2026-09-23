// Are the composer's round buttons' glyphs in the middle? Measured, not eyed.
//
//   node _tools/drive-composer-buttons.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23: "all the buttons are kind off center, send, stop, and
// the +", and, of the stop button, "use this exact same design" (libraries.dev
// beam's round icon button). For Send, Attach (+) and Stop this photographs
// each at four times scale and records, in CSS pixels, how far the glyph's
// own box sits from the button's centre -- in the layout (the element's box)
// and in the pixels actually drawn (the bright ones inside the button).
// One free OpenCode message, to have a stop button. Spends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(new URL('../docs/composer-buttons-2026-09-23/', import.meta.url).pathname.slice(1), tag)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-buttons-ws-')
const drive = await startDrive({
  name: 'composer-buttons',
  port: 9405,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

const SCALE = 4
const PAD = 6
const measured = {}

/** The button's box and its glyph's box, in CSS pixels, and a 4x photograph of the button. */
const measure = async (label, buttonSelector, glyphSelector) => {
  const geometry = JSON.parse(await drive.evaluate(`(() => {
    const button = document.querySelector('${buttonSelector}')
    if (!button) return JSON.stringify(null)
    const glyph = button.querySelector('${glyphSelector}')
    const b = button.getBoundingClientRect()
    const g = glyph ? glyph.getBoundingClientRect() : null
    const style = getComputedStyle(button)
    return JSON.stringify({
      button: { x: b.left, y: b.top, width: b.width, height: b.height },
      glyph: g ? { x: g.left, y: g.top, width: g.width, height: g.height } : null,
      radius: style.borderRadius,
      background: style.backgroundColor
    })
  })()`))
  if (geometry === null) {
    say(`${label}: not on screen`)
    return
  }
  const { button, glyph } = geometry
  const layout = glyph === null ? null : {
    dx: +(glyph.x + glyph.width / 2 - (button.x + button.width / 2)).toFixed(2),
    dy: +(glyph.y + glyph.height / 2 - (button.y + button.height / 2)).toFixed(2)
  }
  const shot = await drive.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: button.x - PAD, y: button.y - PAD, width: button.width + PAD * 2, height: button.height + PAD * 2, scale: SCALE }
  })
  const file = `${label}.png`
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
  measured[label] = { ...geometry, layout, file, scale: SCALE, pad: PAD }
  say(`${label}: ${Math.round(button.width)}x${Math.round(button.height)} radius ${geometry.radius}; glyph ${glyph === null ? 'none' : `${glyph.width.toFixed(1)}x${glyph.height.toFixed(1)}`}; layout offset ${JSON.stringify(layout)}`)
}

try {
  await drive.ready()
  await drive.resize(1120, 720)
  say(await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  // Text in the box, so Send is live rather than dimmed.
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    set.call(field, 'Read README.md and LOCUST.md, list the files here, then describe this project in three sentences.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return 'typed'
  })()`)
  await sleep(600)
  await measure('send', 'button[aria-label="Start mission"]', 'svg')
  await measure('attach', 'button[aria-label="Attach files"]', 'svg')
  await drive.evaluate(`(document.querySelector('button[aria-label="Start mission"]').click(), 'sent')`)
  await drive.waitFor(`!!document.querySelector('button[aria-label="Stop the running mission"]')`, { timeoutMs: 30_000, what: 'the stop button' })
  await sleep(1500)
  await measure('stop', 'button[aria-label="Stop the running mission"]', '.lc-stopsquare')
  const beam = await drive.evaluate(`(() => {
    const wrap = document.querySelector('.lc-stopbeam')
    return JSON.stringify(wrap ? { radius: getComputedStyle(wrap).borderRadius, size: [Math.round(wrap.getBoundingClientRect().width), Math.round(wrap.getBoundingClientRect().height)] } : null)
  })()`)
  say(`stop beam: ${beam}`)
  await writeFile(join(OUT, 'measured.json'), JSON.stringify(measured, null, 2))
  await drive.waitFor(`!document.querySelector('button[aria-label="Stop the running mission"]')`, { timeoutMs: 150_000, everyMs: 1000, what: 'the run to finish' })
  say('\nMEASURED')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "The composer's round buttons, measured. One free OpenCode message." })
}
