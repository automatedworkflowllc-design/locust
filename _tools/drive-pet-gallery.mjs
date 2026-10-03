// The openpets.dev gallery, on the real app and the real network (0.563):
// open the look picker, browse Featured, search, add one pet with a click,
// make a teammate wearing it, and find it still worn after a relaunch.
//
//   LOCUST_NETWORK=1 node _tools/drive-pet-gallery.mjs [--packaged <exe>]
//
// Opt-in, because it reaches openpets.dev and downloads one pet's sheet (a
// few megabytes) into the drive's own profile, which is deleted after. No
// model is run. Colin, 2026-10-03: "theyre just going to be added to the
// list of potential choices for teammates".

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
const OUT = join(recordRoot('pet-gallery-2026-10-03'), tag)
await mkdir(OUT, { recursive: true })

const seed = { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' } }
const workspace = await scratchRepository('locust-drive-pet-gallery-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const openGallery = `(async () => {
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
  const browse = document.querySelector('.lc-pets__browse')
  browse?.click()
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (document.querySelectorAll('.lc-petgallery__tile').length > 0 || document.querySelector('.lc-petgallery__note')) break
  }
  document.querySelector('.lc-petgallery')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 2500))
  const tiles = [...document.querySelectorAll('.lc-petgallery__tile')]
  return JSON.stringify({
    dialog: document.querySelector('[role=dialog][aria-label="New teammate"]') !== null,
    homeButton: first !== undefined,
    tiles: tiles.length,
    pictures: tiles.filter((tile) => tile.querySelector('img') !== null).length,
    first: tiles.slice(0, 4).map((tile) => tile.dataset.pet),
    more: document.querySelector('.lc-petgallery__more')?.innerText ?? '',
    note: document.querySelector('.lc-petgallery__note')?.innerText ?? '',
    credit: document.querySelector('.lc-petgallery__credit')?.innerText ?? ''
  })
})()`
const search = (words) => `(async () => {
  const field = document.querySelector('.lc-petgallery__search')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(words)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 2500))
  return JSON.stringify([...document.querySelectorAll('.lc-petgallery__tile')].map((tile) => tile.dataset.pet + ':' + tile.querySelector('.lc-petgallery__name')?.innerText))
})()`
const addFirst = `(async () => {
  const tile = document.querySelector('.lc-petgallery__tile')
  const id = tile?.dataset.pet ?? ''
  tile?.click()
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    const now = document.querySelector('.lc-petgallery__tile[data-pet="' + id + '"]')
    if (now?.classList.contains('is-selected')) break
    if (document.querySelector('.lc-petgallery__note.lc-tone-amber')) break
  }
  await new Promise((r) => setTimeout(r, 1500))
  const preview = document.querySelector('.lc-dialog__identity .lc-bot canvas')
  return JSON.stringify({
    id,
    state: document.querySelector('.lc-petgallery__tile[data-pet="' + id + '"] .lc-petgallery__state')?.innerText ?? '',
    failure: document.querySelector('.lc-petgallery__note.lc-tone-amber')?.innerText ?? '',
    name: document.querySelector('#lc-teammate-name')?.value ?? '',
    preview: preview?.dataset.face ?? '',
    onComputer: [...document.querySelectorAll('[role=group][aria-label="Pets"] [role=radio][data-pet]')].map((tile) => tile.dataset.source + '/' + tile.dataset.pet)
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

let drive = await startDrive({ name: `pet-gallery-${tag}`, port: 9886, workspace, outPath: OUT, keep: true, seed, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
const profilePath = drive.profile
let added = ''
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1200)
  const gallery = JSON.parse(String(await drive.capture('The gallery, Featured', () => drive.evaluate(openGallery))))
  check('the gallery opens in place with Featured pets, their pictures and More', gallery.tiles >= 12 && gallery.pictures >= 6 && /^More/.test(gallery.more) && /Rights stay with each pet/.test(gallery.credit), JSON.stringify(gallery))
  const found = JSON.parse(String(await drive.capture('Searched: hamster', () => drive.evaluate(search('hamster')))))
  // A search matches a pet's description too (a hamster's wheel), so one name at least, and fewer than before.
  check('a search narrows the gallery', found.length >= 1 && found.length < gallery.tiles && found.some((tile) => /hamster/i.test(tile)), found.join(' | '))
  const result = JSON.parse(String(await drive.capture('Added with a click', () => drive.evaluate(addFirst))))
  added = result.id
  check('a click adds that pet to this computer and the teammate wears it, named after it', result.failure === '' && /^wearing$/i.test(result.state) && result.preview === 'pet' && result.name.length > 0 && result.onComputer.includes(`gallery/${result.id}`), JSON.stringify(result))
  const made = String(await drive.capture('Created', () => drive.evaluate(create)))
  const faces = JSON.parse(String(await drive.evaluate(worn)))
  check('the new teammate wears the gallery pet in the sidebar', made === 'created' && faces.some((face) => face.pet === added && face.face === 'pet' && face.painted >= 10), JSON.stringify(faces))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Reaches openpets.dev; downloads one pet into the drive's profile.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `pet-gallery-${tag}-again`, port: 9886, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 10, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const faces = JSON.parse(String(await drive.capture('After a relaunch', () => drive.evaluate(worn))))
  check('after a relaunch the teammate still wears the gallery pet', added !== '' && faces.some((face) => face.pet === added && face.face === 'pet' && face.painted >= 10), JSON.stringify(faces))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'PET GALLERY PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
