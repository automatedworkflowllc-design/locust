// Every Settings page at two window sizes: no control is cut (0.635).
//
//   node _tools/drive-settings-controls-whole.mjs [--packaged <Locust.exe>] [--tag <name>]
//
// Found while filming the face legend (2026-10-05): at an 860x720 window the
// Terminal faces line's On/Off pair read "On" and half an "Off". The pair
// clips what overflows it, so in the line's flex row it had no minimum and was
// the thing that shrank beside the long sentence. This opens each page in
// Settings' own list at 1215x800 and 860x720 and fails when, in any setting
// line, a control or preview pokes past the line's edge or an On/Off pair is
// narrower than its buttons. Frames of every page are kept. Sends nothing.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'

const drive = await startDrive({
  name: `settings-controls-${tag}`,
  port: 9935,
  workspace: await scratchRepository('locust-drive-settings-controls-ws-'),
  sendsNothing: true,
  outPath: join(recordRoot('settings-controls-2026-10-05'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}

const openSettings = `(async () => {
  for (let i = 0; i < 40 && !document.querySelector('.lc-settings__pane'); i += 1) {
    const settings = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Settings')
    if (settings) settings.click()
    await new Promise((r) => setTimeout(r, 400))
  }
  return document.querySelector('.lc-settings__pane') ? JSON.stringify([...document.querySelectorAll('.lc-settings__navitem')].map((b) => b.innerText.trim())) : 'null'
})()`

const openPage = (label) => `(async () => {
  const item = [...document.querySelectorAll('.lc-settings__navitem')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  if (!item) return 'no page'
  item.click()
  await new Promise((r) => setTimeout(r, 700))
  return 'open'
})()`

/** Every setting line on the page: anything beside its words that leaves the line, and any On/Off pair cut short. */
const MEASURE = `(() => {
  const cuts = []
  const lines = [...document.querySelectorAll('.lc-settings__pane .lc-settingline')]
  for (const line of lines) {
    const edge = line.getBoundingClientRect()
    const name = line.querySelector('.lc-settings__heading')?.textContent?.trim() ?? '(a line)'
    for (const child of line.children) {
      if (child.classList.contains('lc-settingline__text')) continue
      const box = child.getBoundingClientRect()
      if (box.width === 0) continue
      if (box.right > edge.right + 1 || box.left < edge.left - 1) cuts.push({ line: name, what: child.className, over: Math.round(box.right - edge.right) })
    }
    for (const pair of line.querySelectorAll('.lc-segmented')) {
      if (pair.scrollWidth > pair.clientWidth + 1) cuts.push({ line: name, what: 'lc-segmented', clipped: pair.scrollWidth - pair.clientWidth })
    }
  }
  return JSON.stringify({ lines: lines.length, cuts, widened: document.documentElement.scrollWidth > document.documentElement.clientWidth })
})()`

try {
  await drive.ready()
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  for (const [width, height] of [[1215, 800], [860, 720]]) {
    await drive.resize(width, height)
    await sleep(400)
    const pages = JSON.parse(String(await drive.evaluate(openSettings)))
    check(`at ${String(width)}x${String(height)}: Settings opens with its pages`, Array.isArray(pages) && pages.length > 0, JSON.stringify(pages))
    if (!Array.isArray(pages)) continue
    let lines = 0
    for (const label of pages) {
      const opened = await drive.evaluate(openPage(label))
      if (opened !== 'open') {
        check(`at ${String(width)}: ${label} opens`, false, opened)
        continue
      }
      const got = JSON.parse(String(await drive.capture(`${String(width)}x${String(height)} ${label}`, () => drive.evaluate(MEASURE))))
      lines += got.lines
      if (got.lines > 0 || got.widened) check(`at ${String(width)}: ${label} -- every control whole (${String(got.lines)} lines)`, got.cuts.length === 0 && !got.widened, JSON.stringify(got.cuts))
    }
    check(`at ${String(width)}: setting lines measured`, lines > 0, String(lines))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Every Settings page at 1215x800 and 860x720: no setting line's control is cut.`, extra: `Checks failed: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
