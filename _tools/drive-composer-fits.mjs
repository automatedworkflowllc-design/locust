// The chat box's controls fit their row, with the side panel open
// (fresh-eyes check; Colin's 0.402 test run: at 1120x720 with the inspector
// open the controls needed 691px in a 648px row -- "43px clipped"). MEASURED
// 2026-09-27: the 43px is the send button's glow, drawn outside the button on
// purpose and clipped by nothing; no control is past the row at any size.
//
//   node _tools/drive-composer-fits.mjs [--packaged <exe>] [--tag <name>]
//
// Free model. Wren answers one word, so there is a conversation; Activity
// opens the inspector. At four window sizes, with the inspector open and
// then closed: the controls row does not scroll or clip, and every button
// in the chat box lies inside it.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('composer-fits-2026-09-27'), `composer-fits-${tag}`)
await mkdir(OUT, { recursive: true })
const drive = await startDrive({
  name: `composer-fits-${tag}`,
  port: 9721,
  workspace: await scratchRepository('locust-composer-fits-ws-'),
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const MEASURE = `JSON.stringify((() => {
  const row = document.querySelector('.lc-composer__controls')
  const inner = document.querySelector('.lc-composer__inner')?.getBoundingClientRect()
  const inspector = document.querySelector('.lc-inspector')?.getBoundingClientRect()
  const edge = Math.min(inner?.right ?? 99999, inspector && inspector.width > 0 ? inspector.left : 99999)
  const buttons = [...document.querySelectorAll('.lc-composer__inner button')].filter((b) => b.offsetParent !== null)
  const outside = buttons.filter((b) => { const r = b.getBoundingClientRect(); return r.right > edge + 1 || r.left < (inner?.left ?? 0) - 1 }).map((b) => (b.getAttribute('aria-label') || b.innerText || '?').trim().slice(0, 30))
  const rowBox = row?.getBoundingClientRect()
  // The send button's metal glow is DRAWN past the button on purpose (two
  // absolute canvases); it made scrollWidth read 43px over at every size,
  // which is what Colin's 0.402 run measured as "clipped". Nothing clips it
  // (no overflow on the row or the box). Real content past the edge counts.
  const decorative = (el) => el.tagName === 'CANVAS' && /metal-fx/.test(String(el.className?.baseVal ?? el.className))
  const past = row ? [...row.querySelectorAll('*')].filter((el) => !decorative(el) && !el.closest('canvas') && el.getBoundingClientRect().right > rowBox.right + 1).map((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return (el.className?.baseVal ?? el.className) + ' ' + el.tagName + ' right+' + Math.round(r.right - rowBox.right) + ' w' + Math.round(r.width) + ' vis:' + cs.visibility + ' op:' + cs.opacity + ' pos:' + cs.position
  }).slice(0, 8) : []
  return { past, rowScroll: row ? row.scrollWidth : -1, rowClient: row ? row.clientWidth : -1, inner: Math.round(inner?.width ?? 0), inspector: inspector ? Math.round(inspector.width) : 0, outside }
})())`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(500)
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word: ready.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
    }
    return 'timed out'
  })()`))
  check('Wren answered, so there is a conversation', sent === 'ended', sent)
  for (const inspectorOpen of [true, false]) {
    for (const [width, height] of [[1920, 1080], [1440, 900], [1215, 800], [1120, 720]]) {
      await drive.resize(width, height)
      await sleep(900)
      // Open or close the inspector with the header's own Activity button.
      await drive.evaluate(`(async () => {
        const open = document.querySelector('.lc-inspector') !== null
        if (open !== ${String(inspectorOpen)}) [...document.querySelectorAll('button')].find((b) => /Activity/.test(b.innerText || ''))?.click()
        await new Promise((r) => setTimeout(r, 700))
      })()`)
      const label = `${String(width)}x${String(height)}, inspector ${inspectorOpen ? 'open' : 'closed'}`
      const seen = JSON.parse(String(await drive.capture(label, () => drive.evaluate(MEASURE))))
      check(`${label}: nothing but the send button's glow reaches past the controls row`, seen.past.length === 0, JSON.stringify(seen.past))
      check(`${label}: every chat box button inside it, and left of the inspector`, seen.outside.length === 0, JSON.stringify(seen.outside))
    }
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Wren on a free model; the chat box measured with the inspector open and closed.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
