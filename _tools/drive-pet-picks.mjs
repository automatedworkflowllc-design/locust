// The pets Locust offers (shared/pet-picks.ts), on the real app and the real
// network (0.564): open the look picker, find exactly those pets with their
// pictures and no gallery, download one with a click, make a teammate wearing
// it, and find it still worn after a relaunch.
//
//   LOCUST_NETWORK=1 node _tools/drive-pet-picks.mjs [--packaged <exe>]
//
// Opt-in, because it reaches openpets.dev and downloads one pet's sheet (a
// few megabytes) into the drive's own profile, which is deleted after. No
// model is run. Colin, 2026-10-03, of the pets he had added: "i want to keep
// those and remove all the others".

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_NETWORK !== '1') {
  say('This drive reaches openpets.dev and downloads one pet. Re-run with LOCUST_NETWORK=1 if you mean it.')
  process.exit(2)
}
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = packaged === undefined ? 'local' : 'packaged'
const OUT = join(recordRoot('pet-picks-2026-10-03'), tag)
await mkdir(OUT, { recursive: true })
// The picks, in their order (shared/pet-picks.ts); the drive reads the window, not the source.
const PICKS = ['luna-techbot', 'pixel-terminal', 'yeelight-scene-screen-commander', 'reaper', 'glitchcat', 'dot', 'brew', 'rainbow-terminal-cat', 'tmuxai', 'meowbyte', 'robot', 'astro-bot', 'meowbot', 'bitty', 'cloud-puff', 'nori', 'bankr', 'cabin-face', 'dumpster-fire', 'macintosh', 'codex-buddy']
const PICKED = 'robot'

const seed = { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' } }
const workspace = await scratchRepository('locust-drive-pet-picks-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const openPicker = `(async () => {
  // A profile with nobody on the team opens on Home, whose own button makes the first teammate --
  // once the opening splash has given way to it.
  let first
  for (let i = 0; i < 60 && first === undefined; i += 1) {
    first = [...document.querySelectorAll('button.lc-chipbutton')].find((b) => /New teammate/.test(b.textContent ?? ''))
    if (first === undefined) await new Promise((r) => setTimeout(r, 250))
  }
  if (first) {
    first.click()
  } else {
    if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
    await new Promise((r) => setTimeout(r, 900))
    document.querySelector('.lc-rostercard--new')?.click()
  }
  await new Promise((r) => setTimeout(r, 1200))
  document.querySelector('.lc-pets')?.scrollIntoView({ block: 'center' })
  const tiles = () => [...document.querySelectorAll('[role=group][aria-label="Pets"] [role=radio][data-pet]')]
  // Pictures come from openpets.dev the first time: wait for most of them.
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (tiles().filter((tile) => tile.querySelector('img') !== null).length >= ${PICKS.length}) break
  }
  await new Promise((r) => setTimeout(r, 800))
  return JSON.stringify({
    dialog: document.querySelector('[role=dialog][aria-label="New teammate"]') !== null,
    ids: tiles().map((tile) => tile.dataset.pet),
    pictures: tiles().filter((tile) => tile.querySelector('img') !== null).length,
    toDownload: tiles().filter((tile) => tile.dataset.here === 'no').length,
    gallery: document.querySelector('.lc-petgallery, .lc-pets__browse, input[aria-label="Search pets"]') !== null,
    credit: document.querySelector('.lc-pets__credit')?.innerText ?? ''
  })
})()`
const pick = `(async () => {
  const id = ${JSON.stringify(PICKED)}
  const tile = () => document.querySelector('[role=group][aria-label="Pets"] [data-pet="' + id + '"]')
  tile()?.click()
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (tile()?.getAttribute('aria-checked') === 'true') break
    if (document.querySelector('.lc-pets__caption.lc-tone-amber')) break
  }
  await new Promise((r) => setTimeout(r, 2000))
  const preview = document.querySelector('.lc-dialog__identity .lc-bot canvas')
  return JSON.stringify({
    id,
    chosen: tile()?.getAttribute('aria-checked') ?? '',
    here: tile()?.dataset.here ?? '',
    failure: document.querySelector('.lc-pets__caption.lc-tone-amber')?.innerText ?? '',
    name: document.querySelector('#lc-teammate-name')?.value ?? '',
    preview: preview?.dataset.face ?? ''
  })
})()`
const create = `(async () => {
  const button = [...document.querySelectorAll('.lc-dialog__foot button')].find((b) => b.innerText.trim() === 'Create teammate')
  button?.click()
  await new Promise((r) => setTimeout(r, 1800))
  return document.querySelector('[role=dialog]') === null ? 'created' : 'still open'
})()`
const worn = `(async () => {
  await new Promise((r) => setTimeout(r, 1200))
  return JSON.stringify([...document.querySelectorAll('.lc-sidebar .lc-bot[data-teammate]')].map((host) => {
    const canvas = host.querySelector('canvas[data-face]')
    let painted = -1
    try {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let opaque = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 40) opaque += 1
      painted = Math.round((opaque / (canvas.width * canvas.height)) * 100)
    } catch { painted = -2 }
    return { pet: host.dataset.pet ?? '', face: canvas?.dataset.face ?? '', painted }
  }))
})()`

let drive = await startDrive({ name: `pet-picks-${tag}`, port: 9886, workspace, outPath: OUT, keep: true, seed, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
let added = ''
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1200)
  const picker = JSON.parse(String(await drive.capture('The pets Locust offers', () => drive.evaluate(openPicker))))
  check('the look picker offers exactly the picks, in order, with their pictures, and no gallery', picker.dialog && JSON.stringify(picker.ids) === JSON.stringify(PICKS) && picker.pictures >= PICKS.length - 2 && !picker.gallery && /Rights stay with each pet/.test(picker.credit), JSON.stringify(picker))
  check('on a new computer every pick is still to download', picker.toDownload === PICKS.length, String(picker.toDownload))
  const result = JSON.parse(String(await drive.capture('Picked with a click', () => drive.evaluate(pick))))
  added = result.id
  check('a click downloads that pet and the teammate wears it, named after it', result.failure === '' && result.chosen === 'true' && result.here === 'yes' && result.preview === 'pet' && result.name.length > 0, JSON.stringify(result))
  const made = String(await drive.capture('Created', () => drive.evaluate(create)))
  const faces = JSON.parse(String(await drive.evaluate(worn)))
  check('the new teammate wears the pet in the sidebar', made === 'created' && faces.some((face) => face.pet === added && face.face === 'pet' && face.painted >= 10), JSON.stringify(faces))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Reaches openpets.dev; downloads one pet into the drive's profile.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `pet-picks-${tag}-again`, port: 9886, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 10, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const faces = JSON.parse(String(await drive.capture('After a relaunch', () => drive.evaluate(worn))))
  check('after a relaunch the teammate still wears the pet', added !== '' && faces.some((face) => face.pet === added && face.face === 'pet' && face.painted >= 10), JSON.stringify(faces))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'PET PICKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
