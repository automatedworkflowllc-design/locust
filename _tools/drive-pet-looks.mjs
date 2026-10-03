// Pets as teammates' faces (0.563), on the real app: a teammate wearing a pet
// shows it in the sidebar and on the Team screen at the bots' sizes, with its
// ring and dot on it; Locust's own pet, one added from the gallery and one
// from Codex all draw; a pet that is gone shows the teammate's bot; Terminal
// faces leaves a pet alone; the look picker lists the pets under the bots and
// makes a new teammate wear one, kept after a relaunch; a pet a teammate
// wears cannot be removed; and a free turn moves the pet through its rows.
//
//   node _tools/drive-pet-looks.mjs [--packaged <exe>]
//
// Colin, 2026-10-03: "theyre just going to be added to the list of potential
// choices for teammates" -- "just clarity these should be the exact same as
// teammates". Offline but for one free OpenCode turn: the gallery pet is
// seeded into the profile from Locust's own sheet, the Codex one into a
// scratch CODEX_HOME; nothing is downloaded (drive-pet-gallery.mjs does that,
// opt-in).

import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_DIR, FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = packaged === undefined ? 'local' : 'packaged'
const OUT = join(recordRoot('pet-looks-2026-10-03'), tag)
await mkdir(OUT, { recursive: true })

const SHEET = join(APP_DIR, 'resources', 'pets', 'hoodie-cat', 'spritesheet.webp')
const petJson = (id, displayName) => JSON.stringify({ id, displayName, description: `${displayName}, for the drive.`, spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 })

// The profile, made here so the pets can be put in it before the app reads it.
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-pet-looks-'))
await mkdir(join(profile, 'pets', 'test-cat'), { recursive: true })
await copyFile(SHEET, join(profile, 'pets', 'test-cat', 'spritesheet.webp'))
await writeFile(join(profile, 'pets', 'test-cat', 'pet.json'), petJson('test-cat', 'Test Cat'))
const codexHome = await mkdtemp(join(tmpdir(), 'locust-drive-pet-codex-'))
await mkdir(join(codexHome, 'pets', 'mochi'), { recursive: true })
await copyFile(SHEET, join(codexHome, 'pets', 'mochi', 'spritesheet.webp'))
await writeFile(join(codexHome, 'pets', 'mochi', 'pet.json'), petJson('mochi', 'Mochi'))

const look = (pet, shape = 'droid') => ({ headwear: 1, accessory: 0, mouth: 0, bot: { shape, face: 'eyes' }, ...(pet === undefined ? {} : { pet }) })
const seed = {
  schemaVersion: 1,
  teammates: [
    { teammateId: 'tm_hood', name: 'Hood', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: look({ source: 'bundled', id: 'hoodie-cat' }) },
    { teammateId: 'tm_toast', name: 'Toast', hue: 'lime', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: look({ source: 'gallery', id: 'test-cat' }) },
    { teammateId: 'tm_mochi', name: 'Mochi', hue: 'rose', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: look({ source: 'codex', id: 'mochi' }) },
    // A pet that is not on this computer any more: the teammate shows its bot.
    { teammateId: 'tm_gone', name: 'Gone', hue: 'clay', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', route: FREE_ROUTE, avatar: look({ source: 'gallery', id: 'gone-pet' }, 'cat') }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
}
const workspace = await scratchRepository('locust-drive-pet-looks-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// Every teammate face on screen: what it wears, its size, whether it drew, and where its dot was put.
const faces = (scope = 'body') => `(async () => {
  await new Promise((r) => setTimeout(r, 900))
  const out = []
  for (const host of document.querySelectorAll(${JSON.stringify(scope)} + ' .lc-bot[data-teammate]')) {
    const box = host.getBoundingClientRect()
    if (box.width < 8 || box.bottom < 0 || box.top > innerHeight) continue
    const canvas = host.querySelector('canvas[data-face]')
    let painted = -1
    if (canvas !== null && canvas.dataset.face === 'pet') {
      try {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let opaque = 0
        for (let i = 3; i < data.length; i += 4) if (data[i] > 40) opaque += 1
        painted = Math.round((opaque / (canvas.width * canvas.height)) * 100)
      } catch { painted = -2 }
    }
    out.push({
      teammate: host.dataset.teammate,
      face: canvas?.dataset.face ?? 'none',
      pet: host.dataset.pet ?? '',
      state: canvas?.dataset.petState ?? '',
      size: Math.round(box.width),
      canvas: canvas === null ? 0 : Math.round(canvas.getBoundingClientRect().width),
      painted,
      dot: host.style.getPropertyValue('--lc-bot-dot-right')
    })
  }
  return JSON.stringify(out)
})()`
const byId = (list) => Object.fromEntries(list.map((face) => [face.teammate, face]))
const drewPet = (face, id) => face !== undefined && face.face === 'pet' && face.pet === id && face.painted >= 15 && face.canvas === face.size && face.dot !== ''

const team = `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('.lc-rostergrid') ? 'team' : 'no team screen'
})()`
const settingsFaces = (label) => `(async () => {
  document.querySelector('button[title="Settings (Ctrl 3)"]').click()
  await new Promise((r) => setTimeout(r, 900))
  const item = [...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('Appearance'))
  item?.click()
  await new Promise((r) => setTimeout(r, 900))
  const button = [...document.querySelectorAll('[data-setting="terminal-faces"] [role=radio]')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  button?.click()
  await new Promise((r) => setTimeout(r, 1000))
  return document.querySelector('[data-setting="terminal-faces"] [role=radio][aria-checked=true]')?.innerText ?? ''
})()`
const openNewTeammate = `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 900))
  document.querySelector('.lc-rostercard--new')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const pets = document.querySelector('[role=group][aria-label="Pets"]')
  pets?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 900))
  return JSON.stringify({
    dialog: document.querySelector('[role=dialog][aria-label="New teammate"]') !== null,
    tiles: [...(pets?.querySelectorAll('[role=radio][data-pet]') ?? [])].map((tile) => tile.dataset.source + '/' + tile.dataset.pet),
    browse: pets?.querySelector('.lc-pets__browse')?.innerText ?? '',
    face: document.querySelector('[role=radiogroup][aria-label="Face"]') !== null
  })
})()`
const pickPet = (id) => `(async () => {
  document.querySelector('[role=group][aria-label="Pets"] [role=radio][data-pet=${JSON.stringify(id)}]')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const tile = document.querySelector('[role=group][aria-label="Pets"] [role=radio][data-pet=${JSON.stringify(id)}]')
  const preview = document.querySelector('.lc-dialog__identity .lc-bot')
  return JSON.stringify({
    chosen: tile?.getAttribute('aria-checked') ?? '',
    face: document.querySelector('[role=radiogroup][aria-label="Face"]') !== null,
    name: document.querySelector('#lc-teammate-name')?.value ?? '',
    preview: preview?.querySelector('canvas')?.dataset.face ?? '',
    previewState: preview?.querySelector('canvas')?.dataset.petState ?? '',
    caption: document.querySelector('.lc-pets__caption')?.innerText ?? '',
    chips: document.querySelectorAll('.lc-hue__chip').length
  })
})()`
const tryRemove = (id) => `(async () => {
  document.querySelector('[role=group][aria-label="Pets"] [data-pet=${JSON.stringify(id)}]')?.closest('.lc-pettile')?.querySelector('.lc-pettile__remove')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return JSON.stringify({
    notice: [...document.querySelectorAll('.lc-pets__caption')].map((line) => line.innerText).join(' | '),
    still: document.querySelector('[role=group][aria-label="Pets"] [role=radio][data-pet=${JSON.stringify(id)}]') !== null
  })
})()`
const create = `(async () => {
  const button = [...document.querySelectorAll('.lc-dialog__foot button')].find((b) => b.innerText.trim() === 'Create teammate')
  button?.click()
  await new Promise((r) => setTimeout(r, 1800))
  return document.querySelector('[role=dialog][aria-label="New teammate"]') === null ? 'created' : 'still open: ' + (document.querySelector('.lc-dialog__error')?.innerText ?? '')
})()`
const createdId = `(() => [...document.querySelectorAll('.lc-faces__one')].find((face) => (face.getAttribute('aria-label') ?? '').startsWith('Hoodie Cat'))?.querySelector('[data-teammate]')?.dataset.teammate ?? '')()`
// What the pet faces show, sampled through a turn.
const petStates = `JSON.stringify([...document.querySelectorAll('canvas[data-face="pet"]')].filter((c) => c.closest('[data-teammate="tm_hood"]')).map((c) => c.dataset.petState))`

let drive = await startDrive({ name: `pet-looks-${tag}`, port: 9885, workspace, outPath: OUT, keep: true, seed, profilePath: profile, env: { CODEX_HOME: codexHome }, sendsNothing: false, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const sidebar = byId(JSON.parse(String(await drive.capture('The sidebar: three pets and a bot', () => drive.evaluate(faces('.lc-sidebar'))))))
  check('Locust’s own pet draws in the sidebar, at the sidebar’s size, with its dot on it', drewPet(sidebar.tm_hood, 'hoodie-cat') && sidebar.tm_hood.state === 'idle', JSON.stringify(sidebar.tm_hood))
  check('a pet added from the gallery draws', drewPet(sidebar.tm_toast, 'test-cat'), JSON.stringify(sidebar.tm_toast))
  check('a Codex pet draws, read from where Codex keeps it', drewPet(sidebar.tm_mochi, 'mochi'), JSON.stringify(sidebar.tm_mochi))
  check('a teammate whose pet is gone shows its bot, not an empty box', sidebar.tm_gone !== undefined && sidebar.tm_gone.face !== 'pet' && sidebar.tm_gone.face !== 'none' && sidebar.tm_gone.pet === '', JSON.stringify(sidebar.tm_gone))

  await drive.evaluate(team)
  const roster = byId(JSON.parse(String(await drive.capture('The Team screen', () => drive.evaluate(faces('.lc-rostergrid'))))))
  check('the Team screen’s cards wear the pets at the card size', ['tm_hood', 'tm_toast', 'tm_mochi'].every((id) => roster[id]?.face === 'pet' && roster[id].size === 44 && roster[id].painted >= 15), JSON.stringify(Object.values(roster)))

  const off = String(await drive.capture('Terminal faces Off', () => drive.evaluate(settingsFaces('Off'))))
  const afterOff = byId(JSON.parse(String(await drive.evaluate(faces('.lc-sidebar')))))
  check('Terminal faces leaves a pet alone', off === 'Off' && ['tm_hood', 'tm_toast', 'tm_mochi'].every((id) => afterOff[id]?.face === 'pet'), JSON.stringify(Object.values(afterOff).map((f) => `${f.teammate}:${f.face}`)))
  await drive.evaluate(settingsFaces('On'))

  // Reduced motion: a working pet's frame stays put.
  await drive.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })

  const picker = JSON.parse(String(await drive.capture('New teammate: the pets under the bots', () => drive.evaluate(openNewTeammate))))
  check('the look picker lists the pets on this computer under the bots: Locust’s own, the added one, Codex’s', picker.dialog && ['bundled/hoodie-cat', 'gallery/test-cat', 'codex/mochi'].every((tile) => picker.tiles.includes(tile)) && picker.browse === 'Browse the gallery' && picker.face, JSON.stringify(picker))
  const removed = JSON.parse(String(await drive.capture('Removing a pet a teammate wears', () => drive.evaluate(tryRemove('test-cat')))))
  check('a pet a teammate wears cannot be removed, and the picker says who wears it', removed.still && /Toast wears this pet/.test(removed.notice), JSON.stringify(removed))
  const picked = JSON.parse(String(await drive.capture('Picked Hoodie Cat', () => drive.evaluate(pickPet('hoodie-cat')))))
  check('picking a pet wears it: the face choice steps aside, the name is the pet’s, the preview is the pet at work', picked.chosen === 'true' && !picked.face && picked.name === 'Hoodie Cat' && picked.preview === 'pet' && picked.previewState === 'running' && picked.chips === 9, JSON.stringify(picked))
  const made = String(await drive.capture('Created', () => drive.evaluate(create)))
  await sleep(800)
  const id = String(await drive.evaluate(createdId))
  const after = byId(JSON.parse(String(await drive.evaluate(faces('.lc-sidebar')))))
  check('the new teammate wears the pet in the sidebar', made === 'created' && id !== '' && drewPet(after[id], 'hoodie-cat'), `${made} ${id} ${JSON.stringify(after[id])}`)
  await drive.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })

  // A free turn: the pet works, then rests.
  say(String(await drive.evaluate(openTeammateScript('Hood'))))
  await drive.evaluate(sendAndWaitScript('Reply with exactly three words about cats.', { settle: false }))
  const seen = new Set()
  for (let i = 0; i < 240; i += 1) {
    for (const state of JSON.parse(String(await drive.evaluate(petStates)))) seen.add(state)
    const running = await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]') !== null`)
    if (i > 6 && running !== true) break
    await sleep(500)
  }
  await drive.capture('After the turn', () => sleep(1500))
  const settled = JSON.parse(String(await drive.evaluate(petStates)))
  check('a free turn moves the pet through its rows -- review or running while it works', seen.has('running') || seen.has('review') || seen.has('waving'), [...seen].join(' '))
  check('and it comes back to rest, or jumps for done', settled.length > 0 && settled.every((state) => ['idle', 'jumping', 'failed'].includes(state)), settled.join(' '))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Pets seeded in the profile and a scratch CODEX_HOME; one free OpenCode turn.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

await mkdir(join(OUT, 'after-relaunch'), { recursive: true })
drive = await startDrive({ name: `pet-looks-${tag}-again`, port: 9885, workspace, outPath: join(OUT, 'after-relaunch'), profilePath: profile, env: { CODEX_HOME: codexHome }, stepFrom: 20, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  const again = JSON.parse(String(await drive.capture('After a relaunch', () => drive.evaluate(faces('.lc-sidebar')))))
  const created = again.find((face) => !['tm_hood', 'tm_toast', 'tm_mochi', 'tm_gone'].includes(face.teammate))
  check('after a relaunch the new teammate still wears its pet', created !== undefined && drewPet(created, 'hoodie-cat'), JSON.stringify(created))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'PET LOOKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
