// Plush, round trip (0.577): off by default, switched on in Settings >
// Appearance, every bot drawn in fur at once -- a short pile under 40 px --
// still on after a relaunch, and off again puts the plastic back. Read from
// each canvas's own word for its material and from its pixels (fur's edge
// is a fringe of part-covered pixels; plastic's is an anti-aliased line).
//
//   node _tools/drive-plush.mjs [--packaged <exe>]
//
// Colin, 2026-10-03, accepted: Plush as an option; a short pile under ~40 px,
// the library's own fabric above. Costs nothing: no run is started.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = packaged === undefined ? 'local' : 'packaged'
const OUT = join(recordRoot('plush-2026-10-04'), tag)
await mkdir(OUT, { recursive: true })

const seed = {
  schemaVersion: 1,
  teammates: [
    { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE },
    { teammateId: 'tm_ada', name: 'Ada', hue: 'blue', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'cloud', face: 'eyes' } } },
    { teammateId: 'tm_ivo', name: 'Ivo', hue: 'clay', role: 'Code & Migrations', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 1, accessory: 1, mouth: 1, bot: { shape: 'cat', face: 'eyes' } } },
    { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: { headwear: 2, accessory: 0, mouth: 0, bot: { shape: 'clover', face: 'eyes' } } }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
}
const workspace = await scratchRepository('locust-drive-plush-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// Every bot canvas on screen: the material it says it is drawn in, and how soft
// its silhouette is -- part-covered pixels per hundred solid ones.
const faces = `(async () => {
  await new Promise((r) => setTimeout(r, 2500))
  const out = []
  for (const canvas of document.querySelectorAll('canvas[data-material]')) {
    const box = canvas.getBoundingClientRect()
    if (box.width < 14 || box.bottom < 0 || box.top > innerHeight) continue
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    let data
    try { data = ctx.getImageData(0, 0, w, h).data } catch { continue }
    let solid = 0, soft = 0
    for (let i = 3; i < data.length; i += 4) { if (data[i] >= 230) solid += 1; else if (data[i] > 12) soft += 1 }
    if (solid === 0) continue
    // The canvas is the bot's size times the rig's overscan (BOT_AVATAR_OVERSCAN, 1.5).
    out.push({ material: canvas.dataset.material, size: Math.round(box.width / 1.5), soft: Math.round((soft / solid) * 1000) / 10, teammate: canvas.closest('[data-teammate]')?.dataset.teammate, sidebar: !!canvas.closest('.lc-sidebar') })
  }
  return JSON.stringify(out)
})()`
const openAppearance = `(async () => {
  document.querySelector('button[title="Settings (Ctrl 3)"]').click()
  await new Promise((r) => setTimeout(r, 900))
  const item = [...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('Appearance'))
  item?.click()
  await new Promise((r) => setTimeout(r, 900))
  const row = document.querySelector('[data-setting="plush"]')
  row?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 500))
  return JSON.stringify({
    row: row !== null,
    lede: row?.querySelector('.lc-settings__lede')?.innerText ?? '',
    on: row?.querySelector('[role=radio][aria-checked=true]')?.innerText ?? ''
  })
})()`
const choose = (label) => `(async () => {
  const button = [...document.querySelectorAll('[data-setting="plush"] [role=radio]')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  button?.click()
  await new Promise((r) => setTimeout(r, 1500))
  return document.querySelector('[data-setting="plush"] [role=radio][aria-checked=true]')?.innerText ?? ''
})()`
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}
const summary = (list) => {
  const by = (material) => list.filter((f) => f.material === material)
  const plush = [...by('plush'), ...by('plush-short')]
  return {
    plastic: by('plastic').length,
    plush: plush.length,
    short: by('plush-short').map((f) => f.size),
    full: by('plush').map((f) => f.size),
    softPlastic: median(by('plastic').map((f) => f.soft)),
    softPlush: median(plush.map((f) => f.soft)),
    wrenSoft: list.find(f => f.sidebar && f.teammate === 'tm_wren')?.soft ?? 0
  }
}

let drive = await startDrive({ name: `plush-${tag}`, port: 9883, workspace, outPath: OUT, keep: true, seed, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
let plasticSoft = 0
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const first = summary(JSON.parse(String(await drive.capture('Off by default: every bot plastic', () => drive.evaluate(faces)))))
  plasticSoft = first.wrenSoft
  check('off by default: every bot is drawn in plastic', first.plush === 0 && first.plastic >= 4, JSON.stringify(first))
  const row = JSON.parse(String(await drive.capture('Settings > Appearance: Plush', () => drive.evaluate(openAppearance))))
  check('Settings > Appearance has Plush, Off', row.row && row.on === 'Off' && /plastic/.test(row.lede), JSON.stringify(row))
  const on = String(await drive.capture('Switched On', () => drive.evaluate(choose('On'))))
  check('On is taken', on === 'On', on)
  const after = summary(JSON.parse(String(await drive.capture('On: the preview and sidebar, in fur', () => drive.evaluate(faces)))))
  check('on: every bot is plush at once, the small ones in the short pile', after.plastic === 0 && after.plush >= 4 && after.short.every((size) => size < 40) && after.full.every((size) => size >= 40), JSON.stringify(after))
  // CHANGELOG 0.577.0: "the fur is a shorter, combed pile" at sidebar size.
  // Compare the same seeded bot at the same size, not medians across Home's
  // cards and Settings' different preview shapes and sizes. All bots' material
  // and the short/full size boundary are still checked above.
  check('the same sidebar bot has a visibly softer fur edge than its plastic had', plasticSoft > 0 && after.wrenSoft > plasticSoft * 1.5, `plastic ${String(plasticSoft)} vs plush ${String(after.wrenSoft)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. No run. Plush off by default, then switched on.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `plush-${tag}-again`, port: 9883, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 5, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(2000)
  const relaunched = summary(JSON.parse(String(await drive.capture('After a relaunch: still plush', () => drive.evaluate(faces)))))
  check('after a relaunch it is still on: every bot plush', relaunched.plastic === 0 && relaunched.plush >= 4, JSON.stringify(relaunched))
  const row = JSON.parse(String(await drive.capture('Settings still says On', () => drive.evaluate(openAppearance))))
  check('Settings still says On', row.on === 'On', JSON.stringify(row))
  const off = String(await drive.capture('Switched back Off', () => drive.evaluate(choose('Off'))))
  const back = summary(JSON.parse(String(await drive.capture('Off again: plastic', () => drive.evaluate(faces)))))
  check('Off again puts the plastic back at once', off === 'Off' && back.plush === 0 && back.plastic >= 4, JSON.stringify(back))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'PLUSH PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
