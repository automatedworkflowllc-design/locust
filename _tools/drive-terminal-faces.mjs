// Terminal faces, round trip: on by default, switched off in Settings, still
// off after a relaunch, and the bots in the sidebar and on the Team screen
// wearing what the switch says -- read from each canvas's pixels (a screen is
// a dark field at the face) as well as from what it says it wears.
//
//   node _tools/drive-terminal-faces.mjs [--packaged <exe>]
//
// Colin, 2026-10-03: "maybe im realizing they might all need a screen for a
// face, we can have it togglable in settings, terminal face, and if the user
// chooses to have it off it will revert back to our previous eyes."
// Costs nothing: no run is started.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = packaged === undefined ? 'local' : 'packaged'
const OUT = join(recordRoot('terminal-faces-2026-10-03'), tag)
await mkdir(OUT, { recursive: true })

const seed = {
  schemaVersion: 1,
  teammates: [
    { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE },
    { teammateId: 'tm_ada', name: 'Ada', hue: 'blue', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' } } },
    { teammateId: 'tm_ivo', name: 'Ivo', hue: 'clay', role: 'Code & Migrations', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 1, accessory: 1, mouth: 1, bot: { shape: 'cat', face: 'eyes' } } },
    // 0.562: a teammate's own choice beats its shape's default, both ways.
    { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 2, accessory: 0, mouth: 0, bot: { shape: 'star', face: 'eyes', screen: true } } },
    { teammateId: 'tm_moss', name: 'Moss', hue: 'blue', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 3, accessory: 2, mouth: 1, bot: { shape: 'droid', face: 'eyes', screen: false } } }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
}
const workspace = await scratchRepository('locust-drive-terminal-faces-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// Every bot canvas on screen: what it says it wears, and how dark its face is
// (the share of the body far darker than its own plastic).
const faces = `(async () => {
  await new Promise((r) => setTimeout(r, 900))
  const out = []
  for (const canvas of document.querySelectorAll('canvas[data-face]')) {
    const box = canvas.getBoundingClientRect()
    if (box.width < 20 || box.bottom < 0 || box.top > innerHeight) continue
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    let data
    try { data = ctx.getImageData(0, 0, w, h).data } catch { continue }
    let minX = w, minY = h, maxX = 0, maxY = 0
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (data[(y * w + x) * 4 + 3] > 200) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    if (maxX <= minX) continue
    // How much of the body is far darker than its own plastic: a screen is a big dark patch,
    // a bot's own eyes are a few thin strokes. Wherever the face sits on the body.
    const body = []
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const i = (y * w + x) * 4
      if (data[i + 3] >= 200) body.push(data[i] + data[i + 1] + data[i + 2])
    }
    const median = [...body].sort((a, b) => a - b)[Math.floor(body.length / 2)] ?? 0
    const dark = body.filter((sum) => sum < median * 0.45).length
    const host = canvas.closest('[data-bot]')
    out.push({
      face: canvas.dataset.face,
      bot: host?.dataset.bot ?? '',
      teammate: host?.closest('[data-teammate]')?.dataset.teammate ?? '',
      cover: canvas.closest('.lc-cover') !== null,
      darkShare: Math.round((dark / Math.max(1, body.length)) * 100)
    })
  }
  return JSON.stringify(out)
})()`
const openAppearance = `(async () => {
  document.querySelector('button[title="Settings (Ctrl 3)"]').click()
  await new Promise((r) => setTimeout(r, 900))
  const item = [...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('Appearance'))
  item?.click()
  await new Promise((r) => setTimeout(r, 900))
  const row = document.querySelector('[data-setting="terminal-faces"]')
  row?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 500))
  return JSON.stringify({
    row: row !== null,
    lede: row?.querySelector('.lc-settings__lede')?.innerText ?? '',
    on: row?.querySelector('[role=radio][aria-checked=true]')?.innerText ?? ''
  })
})()`
const choose = (label) => `(async () => {
  const button = [...document.querySelectorAll('[data-setting="terminal-faces"] [role=radio]')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  button?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('[data-setting="terminal-faces"] [role=radio][aria-checked=true]')?.innerText ?? ''
})()`
const team = `(async () => {
  const button = [...document.querySelectorAll('button')].find((b) => /^Team$/.test(b.innerText.trim()))
  button?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return 'team'
})()`
// What each face should wear (0.562): Prompt always a screen; the title screen's three a screen while
// Terminal faces is on; any other teammate as it chose, or as its shape suits (shared/avatar.ts SCREEN_SHAPES).
const SUITS = new Set(['square', 'ghost', 'circle', 'droid', 'mech', 'hexagon', 'cat', 'pill', 'pebble', 'critter', 'prompt'])
const CHOSE = { tm_juno: true, tm_moss: false }
const expected = (f, on) => f.bot === 'prompt' || (on && (f.cover || (CHOSE[f.teammate] ?? SUITS.has(f.bot))))
const summary = (list, on) => {
  const screens = list.filter((f) => f.face === 'screen')
  const eyes = list.filter((f) => f.face === 'eyes')
  const wrong = list.filter((f) => (f.face === 'screen') !== expected(f, on)).map((f) => `${f.teammate || (f.cover ? 'cover' : '?')}:${f.bot}:${f.face}`)
  // The share of each body that is a dark patch: the least of the screens, the most of the own-eyed.
  return { screens: screens.length, eyes: eyes.length, wrong, leastScreen: Math.min(...screens.map((f) => f.darkShare), 100), mostEyes: Math.max(...eyes.map((f) => f.darkShare), 0) }
}

let drive = await startDrive({ name: `terminal-faces-${tag}`, port: 9881, workspace, outPath: OUT, keep: true, seed, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const first = summary(JSON.parse(String(await drive.capture('On by default: the sidebar', () => drive.evaluate(faces)))), true)
  check('on by default: each bot wears what its shape or its own choice says, a screen a dark field at its face', first.wrong.length === 0 && first.screens >= 3 && first.leastScreen >= 12 && first.mostEyes < 9, JSON.stringify(first))
  const row = JSON.parse(String(await drive.capture('Settings > Appearance: Terminal faces', () => drive.evaluate(openAppearance))))
  check('Settings > Appearance has Terminal faces, On', row.row && row.on === 'On' && /screen for a face/.test(row.lede), JSON.stringify(row))
  const off = String(await drive.capture('Switched Off', () => drive.evaluate(choose('Off'))))
  check('Off is taken', off === 'Off', off)
  const after = summary(JSON.parse(String(await drive.capture('Off: the preview and sidebar', () => drive.evaluate(faces)))), false)
  check('off: every bot keeps its own eyes, no dark field, at once', after.wrong.length === 0 && after.screens === 0 && after.eyes >= 3 && after.mostEyes < 9, JSON.stringify(after))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No run. Terminal faces on by default, then switched off.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `terminal-faces-${tag}-again`, port: 9881, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 5, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  await drive.evaluate(team)
  const relaunched = summary(JSON.parse(String(await drive.capture('After a relaunch: the Team screen', () => drive.evaluate(faces)))), false)
  check('after a relaunch it is still off: the Team screen bots keep their own eyes', relaunched.wrong.length === 0 && relaunched.screens === 0 && relaunched.eyes >= 3 && relaunched.mostEyes < 9, JSON.stringify(relaunched))
  const row = JSON.parse(String(await drive.capture('Settings still says Off', () => drive.evaluate(openAppearance))))
  check('Settings still says Off', row.on === 'Off', JSON.stringify(row))
  const on = String(await drive.capture('Switched back On', () => drive.evaluate(choose('On'))))
  const back = summary(JSON.parse(String(await drive.capture('On again', () => drive.evaluate(faces)))), true)
  check('On again puts the screens back at once, as each chose', on === 'On' && back.wrong.length === 0 && back.screens >= 3 && back.leastScreen >= 12, JSON.stringify(back))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'TERMINAL FACES PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
