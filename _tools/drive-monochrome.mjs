// Locust is monochrome: no lime accent left on screen (0.434).
//
//   node _tools/drive-monochrome.mjs [--packaged <exe>] [--tag <name>]
//
// Spends nothing: no run.
//
// Colin, 2026-09-28: "switch to monochrome for most things unless green makes
// sense." On Home, Memory and Settings (each of its pages that is not
// pictured-private) every element's colour, background, border and outline is
// read, and the ones in the old lime accent (#c9f04a, #dbf785, and their
// tints) are counted. A teammate whose own colour is lime (#a9d93f) is a
// different colour and is not counted. The screens are pictured for Colin to
// look at.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('monochrome-2026-09-28'), `monochrome-${tag}`)
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: `monochrome-${tag}`, port: 9770, workspace: await scratchRepository('locust-drive-mono-ws-'), outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-28T01:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask' } },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-28T01:00:01.000Z', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'auto', autoMode: false, aboutYou: 'Keep answers short.' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** Elements drawn in the old accent, by what part of them. */
const limeCount = `(() => {
  const LIME = /rgba?\\((201, 240, 74|219, 247, 133)(,|\\))/
  const found = []
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0 || style.visibility === 'hidden') continue
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'outlineColor', 'accentColor']) {
      if (LIME.test(style[prop])) {
        // An outline or accent only counts when it is drawn.
        if (prop === 'outlineColor' && style.outlineStyle === 'none') continue
        if (prop.startsWith('border') && style[prop.replace('Color', 'Width')] === '0px') continue
        found.push(prop + ' ' + (el.className?.baseVal ?? el.className ?? el.tagName).toString().split(' ')[0])
        break
      }
    }
  }
  return JSON.stringify({ count: found.length, where: [...new Set(found)].slice(0, 12) })
})()`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  const screens = [
    ['Home', null],
    ['Memory', `window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))`],
    ['Settings', `[...document.querySelectorAll('button')].find((b) => /^Settings$/.test(b.innerText.trim()))?.click()`]
  ]
  for (const [name, open] of screens) {
    if (open !== null) await drive.evaluate(open)
    await sleep(1200)
    const read = JSON.parse(String(await drive.capture(name, () => drive.evaluate(limeCount))))
    say(`  ${name}: ${JSON.stringify(read)}`)
    check(`${name} shows no lime accent`, read.count === 0, JSON.stringify(read))
  }
  // Wren is a lime teammate: her face keeps her colour.
  const wren = String(await drive.evaluate(`(() => {
    const face = document.querySelector('[data-teammate="tm_wren"]')
    return face ? 'found' : 'no face'
  })()`))
  check("a lime teammate's face is still drawn (her own colour is not the accent)", wren === 'found', wren)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No run. Home, Memory and Settings, every element's colours read for the old lime accent.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
