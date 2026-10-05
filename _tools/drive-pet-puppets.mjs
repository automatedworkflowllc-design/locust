// The pets Colin kept, as puppets with our terminal eyes (2026-10-05,
// petPuppets.ts), on the real app: a teammate wearing each of them is a
// puppet with a screen in the sidebar and on the Team screen, one asked for as
// drawn is not; pointed at, a puppet wakes (the glad eyes) and then rests,
// drawing nothing; Terminal faces off draws them as drawn and on makes them
// puppets again; and a new teammate's look offers Bitty As drawn or Screen,
// the choice kept through a relaunch.
//
//   node _tools/drive-pet-puppets.mjs [--packaged <exe>] [--tag <name>] [--out <dir>] [--pets <folder>]
//
// Their sheets are their makers' (openpets.dev): never in this repository, and
// so never in this drive's record either -- the record is kept outside it
// (LOCUST_DRIVE_OUT, or a folder in the system's temp) unless --out says where.
// The sheets are the copies Locust downloaded on this computer, in its own
// userData (%APPDATA%\@teammate\desktop\pets, or --pets), COPIED into the
// drive's scratch profile; a scratch CODEX_HOME keeps the real ~/.codex/pets
// out of it. Without a sheet on this computer, pick that pet once in Locust
// (or run drive-pet-picks.mjs) first. Sends nothing.

import { copyFile, mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const PETS = arg('--pets') ?? join(process.env.APPDATA ?? '', '@teammate', 'desktop', 'pets')
const OUT = arg('--out') ?? join(process.env.LOCUST_DRIVE_OUT ?? join(tmpdir(), 'locust-drive-records'), 'pet-puppets-2026-10-05', tag)
// Each puppet, and the teammate that wears it.
const KEPT = [
  ['cabin-face', 'tm_cabin', 'Cabin'],
  ['astro-bot', 'tm_astro', 'Astro'],
  ['meowbot', 'tm_meow', 'Meow'],
  ['macintosh', 'tm_mac', 'Mac'],
  ['bitty', 'tm_bitty', 'Bitty'],
  ['tmuxai', 'tm_tmux', 'Tmux'],
  ['rainbow-terminal-cat', 'tm_cat', 'Rainbow'],
  ['nori', 'tm_nori', 'Nori']
]

const profile = await mkdtemp(join(tmpdir(), 'locust-drive-puppets-'))
for (const [id] of KEPT) {
  try {
    await stat(join(PETS, id, 'spritesheet.webp'))
  } catch {
    say(`No ${id} sheet in ${PETS}: pick it once in Locust (Pets, in a teammate's look), or give --pets <folder>.`)
    process.exit(2)
  }
  await mkdir(join(profile, 'pets', id), { recursive: true })
  await copyFile(join(PETS, id, 'spritesheet.webp'), join(profile, 'pets', id, 'spritesheet.webp'))
  await copyFile(join(PETS, id, 'pet.json'), join(profile, 'pets', id, 'pet.json'))
}
// Empty: the real ~/.codex/pets is never read.
const codexHome = await mkdtemp(join(tmpdir(), 'locust-drive-puppets-codex-'))

const at = '2026-10-05T09:00:00.000Z'
const wearing = (id, screen) => ({ headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' }, pet: { source: 'gallery', id, ...(screen === undefined ? {} : { screen }) } })
const seed = {
  schemaVersion: 1,
  teammates: [
    ...KEPT.map(([id, teammateId, name]) => ({ teammateId, name, hue: 'blue', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE, avatar: wearing(id, undefined) })),
    { teammateId: 'tm_drawn', name: 'Drawn', hue: 'lime', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE, avatar: wearing('bitty', false) }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
const workspace = await scratchRepository('locust-drive-puppets-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 600)}`}`)
}

// Every teammate face in a part of the window: what it wears, whether it is a puppet with a screen, its eyes, and how much of it is painted.
const faces = (scope = 'body') => `(async () => {
  await new Promise((r) => setTimeout(r, 900))
  const out = {}
  for (const host of document.querySelectorAll(${JSON.stringify(scope)} + ' .lc-bot[data-teammate]')) {
    const box = host.getBoundingClientRect()
    if (box.width < 8) continue
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
    out[host.dataset.teammate] = {
      face: canvas?.dataset.face ?? 'none',
      pet: host.dataset.pet ?? '',
      puppet: canvas?.dataset.puppet ?? '',
      screen: canvas?.dataset.screen ?? '',
      eyes: canvas?.dataset.eyes ?? '',
      state: canvas?.dataset.petState ?? '',
      size: Math.round(box.width),
      shown: box.bottom > 0 && box.top < innerHeight,
      painted
    }
  }
  return JSON.stringify(out)
})()`
const read = async (scope) => JSON.parse(String(await drive.evaluate(faces(scope))))
const team = `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('.lc-rostergrid') ? 'team' : 'no team screen'
})()`
const terminalFaces = (label) => `(async () => {
  document.querySelector('button[title="Settings (Ctrl 3)"]')?.click()
  await new Promise((r) => setTimeout(r, 900))
  const item = [...document.querySelectorAll('.lc-settings__navitem')].find((n) => n.innerText.trim().startsWith('Appearance'))
  item?.click()
  await new Promise((r) => setTimeout(r, 900))
  const button = [...document.querySelectorAll('[data-setting="terminal-faces"] [role=radio]')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  button?.click()
  await new Promise((r) => setTimeout(r, 1000))
  return document.querySelector('[data-setting="terminal-faces"] [role=radio][aria-checked=true]')?.innerText ?? ''
})()`
// Bitty's face on the Team screen, brought into view and made to count the frames it draws (each frame clears its canvas once).
const countBitty = `(async () => {
  const canvas = document.querySelector('.lc-rostergrid [data-teammate="tm_bitty"] canvas[data-puppet="on"]')
  if (!canvas) return 'no puppet'
  canvas.closest('.lc-bot')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 600))
  const context = canvas.getContext('2d')
  if (!context.__counted) {
    const clear = context.clearRect.bind(context)
    window.__bittyFrames = 0
    context.clearRect = (...rect) => { window.__bittyFrames += 1; return clear(...rect) }
    context.__counted = true
  }
  return 'counting'
})()`
const frames = async () => Number(await drive.evaluate('window.__bittyFrames ?? -1'))
// The pointer on Bitty's face, as React hears it, or away again.
const point = (on) => `(() => {
  const host = document.querySelector('.lc-rostergrid .lc-bot[data-teammate="tm_bitty"]')
  if (!host) return 'no face'
  host.dispatchEvent(new PointerEvent(${on ? "'pointerover'" : "'pointerout'"}, { bubbles: true, relatedTarget: ${on ? 'null' : 'document.body'} }))
  return 'ok'
})()`
const openNewTeammate = `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 900))
  document.querySelector('.lc-rostercard--new')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const pets = document.querySelector('[role=group][aria-label="Pets"]')
  pets?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 600))
  pets?.querySelector('[role=radio][data-pet="bitty"]')?.click()
  await new Promise((r) => setTimeout(r, 1500))
  return document.querySelector('[role=dialog][aria-label="New teammate"]') !== null ? 'open' : 'no dialog'
})()`
// The look's face choice, and the preview's face, while a pet is worn.
const lookFace = `JSON.stringify((() => {
  const group = document.querySelector('[role=dialog] [role=radiogroup][aria-label="Face"]')
  const preview = document.querySelector('.lc-dialog__identity .lc-bot canvas')
  return {
    choices: [...(group?.querySelectorAll('[role=radio]') ?? [])].map((b) => b.innerText.trim()),
    chosen: group?.querySelector('[role=radio][aria-checked=true]')?.innerText.trim() ?? '',
    preview: preview?.dataset.face ?? '',
    puppet: preview?.dataset.puppet ?? '',
    name: document.querySelector('#lc-teammate-name')?.value ?? ''
  }
})())`
const choose = (label) => `(async () => {
  const button = [...document.querySelectorAll('[role=dialog] [role=radiogroup][aria-label="Face"] [role=radio]')].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  button?.click()
  await new Promise((r) => setTimeout(r, 900))
  return button === undefined ? 'no ' + ${JSON.stringify(label)} : 'clicked'
})()`
const nameAndCreate = (name) => `(async () => {
  const input = document.querySelector('#lc-teammate-name')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(input, ${JSON.stringify(name)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  const button = [...document.querySelectorAll('.lc-dialog__foot button')].find((b) => b.innerText.trim() === 'Create teammate')
  button?.click()
  await new Promise((r) => setTimeout(r, 1800))
  return document.querySelector('[role=dialog][aria-label="New teammate"]') === null ? 'created' : 'still open: ' + (document.querySelector('.lc-dialog__error')?.innerText ?? '')
})()`
/*
 * What the app says they are doing, once it holds. A launch can count every
 * teammate as stuck for its first seconds, until its runtimes are found
 * (status.ts), and a route that needs setting up keeps them so ("Needs you")
 * -- their faces rightly say it -- so the drive waits for the states to hold
 * for a few seconds, not for a fixed time, and expects of each face what its
 * own state says.
 */
const statesNow = `JSON.stringify(Object.fromEntries([...document.querySelectorAll('.lc-bot[data-teammate] canvas[data-face="pet"]')].map((c) => [c.closest('[data-teammate]').dataset.teammate, c.dataset.petState ?? ''])))`
const settledStates = async (seconds = 60) => {
  let last = ''
  let held = 0
  for (let i = 0; i < seconds * 2; i += 1) {
    const now = String(await drive.evaluate(statesNow))
    held = now === last ? held + 1 : 0
    last = now
    // Twelve seconds unchanged: a runtime's first check has answered by then, or will not.
    if (held >= 24) break
    await sleep(500)
  }
  return JSON.parse(last || '{}')
}
// The eyes each state shows on a screen (TeammateBot's eyeGlyphsFor): at rest the bars, stuck the crossed ones.
const EYES_OF = { idle: '||', failed: '><' }
// Every kept pet's teammate a puppet with a screen, saying what it is doing, and painted.
const isPuppet = (face, id) => face?.face === 'pet' && face.pet === id && face.puppet === 'on' && face.screen === 'on' && face.eyes === EYES_OF[face.state] && face.painted >= 8
const allPuppets = (seen) => KEPT.every(([id, teammateId]) => isPuppet(seen[teammateId], id))

// A teammate's id, from its card on the Team screen: the sidebar's row has room for only a few faces.
const idOf = (name) => `(async () => {
  if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const card = [...document.querySelectorAll('.lc-rostergrid .lc-rostercard')].find((one) => one.querySelector('.lc-rostercard__name')?.textContent?.trim() === ${JSON.stringify(name)})
  return card?.querySelector('[data-teammate]')?.dataset.teammate ?? ''
})()`

let drive = await startDrive({ name: `pet-puppets-${tag}`, port: 9937, workspace, outPath: OUT, keep: true, seed, profilePath: profile, env: { CODEX_HOME: codexHome }, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
let madeId = ''
try {
  await drive.ready()
  // An automated window is not the focused one; a face rightly holds still while the window is behind others.
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const states = await settledStates()
  const bittyState = states.tm_bitty ?? ''
  say(`  (what the app says they are doing: ${JSON.stringify(states)}${bittyState === 'idle' ? '' : ' -- their route has not answered or needs setting up (Home, Connected accounts); their faces say so, and the checks below expect that'})`)
  await sleep(2500)

  // The sidebar's row has room for a few faces, the rest behind its +N: each one shown a puppet.
  const sidebar = await read('.lc-sidebar')
  await drive.capture('The sidebar: the kept pets as puppets', async () => JSON.stringify(sidebar))
  const inRow = KEPT.filter(([, teammateId]) => sidebar[teammateId]?.shown === true)
  check('in the sidebar, each kept pet shown is a puppet with a screen, saying what it is doing', inRow.length >= 3 && inRow.every(([id, teammateId]) => isPuppet(sidebar[teammateId], id)), JSON.stringify(sidebar))

  check('the Team screen opens', (await drive.evaluate(team)) === 'team')
  const roster = await read('.lc-rostergrid')
  await drive.capture('The Team screen: the eight as puppets, Drawn as drawn', async () => JSON.stringify(roster))
  check('on the Team screen, each of the eight is a puppet with a screen on its card, saying what it is doing', allPuppets(roster) && roster.tm_bitty.size >= 28, JSON.stringify(roster))
  check('one whose look asks for Bitty as drawn wears its own face', roster.tm_drawn?.face === 'pet' && roster.tm_drawn.pet === 'bitty' && roster.tm_drawn.puppet === '' && roster.tm_drawn.screen === '' && roster.tm_drawn.painted >= 8, JSON.stringify(roster.tm_drawn))

  // At rest a puppet draws nothing; pointed at, it wakes -- glad eyes -- and then rests again.
  check('Bitty can be counted', (await drive.evaluate(countBitty)) === 'counting')
  await sleep(2000)
  const resting = await frames()
  await sleep(3000)
  check('at rest Bitty draws nothing', (await frames()) === resting, `${String(resting)} -> ${String(await frames())}`)
  await drive.evaluate(point(true))
  await sleep(900)
  const noticed = await drive.capture('Bitty pointed at', async () => JSON.stringify((await read('.lc-rostergrid')).tm_bitty ?? {}))
  // What it is doing now, read from its face: a state can still change under a drive, and the face says so.
  const woke = JSON.parse(String(noticed))
  if (woke.state === 'idle') check('pointed at, at rest, Bitty answers with glad eyes', woke.eyes === '^^', noticed)
  else check('pointed at while stuck, Bitty stays stuck: what a teammate is doing wins over the pointer', woke.eyes === EYES_OF[woke.state], noticed)
  check('awake, Bitty draws', (await frames()) > resting, `${String(resting)} -> ${String(await frames())}`)
  await drive.evaluate(point(false))
  await sleep(3500)
  const settled = await frames()
  await sleep(2500)
  const after = await read('.lc-rostergrid')
  check('left alone, Bitty rests again and draws nothing', (await frames()) === settled && after.tm_bitty?.eyes === EYES_OF[after.tm_bitty?.state], `${String(settled)} -> ${String(await frames())} ${JSON.stringify(after.tm_bitty)}`)

  // Terminal faces: off draws them as drawn, on makes them puppets again.
  check('Terminal faces turns off', (await drive.evaluate(terminalFaces('Off'))) === 'Off')
  check('the Team screen opens again', (await drive.evaluate(team)) === 'team')
  const off = await read('body')
  check('with Terminal faces off each wears its own face everywhere', KEPT.every(([id, teammateId]) => off[teammateId]?.face === 'pet' && off[teammateId].pet === id && off[teammateId].puppet === ''), JSON.stringify(off))
  check('Terminal faces turns on', (await drive.evaluate(terminalFaces('On'))) === 'On')
  check('the Team screen opens once more', (await drive.evaluate(team)) === 'team')
  const on = await read('body')
  check('on again, each is a puppet again', KEPT.every(([, teammateId]) => on[teammateId]?.puppet === 'on'), JSON.stringify(on))

  // A new teammate's look: picking Bitty offers As drawn or Screen.
  check('New teammate opens with Bitty picked', (await drive.evaluate(openNewTeammate)) === 'open')
  const picked = JSON.parse(String(await drive.capture('New teammate: Bitty picked, its face choice', async () => drive.evaluate(lookFace))))
  check('its look offers As drawn or Screen, the screen chosen, the preview a puppet', picked.choices.join('|') === 'As drawn|Screen' && picked.chosen === 'Screen' && picked.preview === 'pet' && picked.puppet === 'on', JSON.stringify(picked))
  check('As drawn can be chosen', (await drive.evaluate(choose('As drawn'))) === 'clicked')
  const drawn = JSON.parse(String(await drive.capture('New teammate: As drawn chosen', async () => drive.evaluate(lookFace))))
  check('chosen as drawn, the preview wears its own face', drawn.chosen === 'As drawn' && drawn.preview === 'pet' && drawn.puppet === '', JSON.stringify(drawn))
  const made = await drive.evaluate(nameAndCreate('Handheld'))
  check('a teammate wearing Bitty as drawn is made', made === 'created', made)
  madeId = String(await drive.evaluate(idOf('Handheld')))
  const made1 = (await read('body'))[madeId]
  check('the new teammate wears Bitty as drawn', madeId !== '' && made1?.face === 'pet' && made1.puppet === '', `${madeId} ${JSON.stringify(made1)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. The kept pets as puppets: sidebar, Team screen, Bitty pointed at and at rest, Terminal faces off and on, Bitty's look's choice. Their sheets copied into a scratch profile; a scratch CODEX_HOME.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

// Relaunched on the same profile: the choice is kept with the teammate.
if (madeId !== '') {
  drive = await startDrive({ name: `pet-puppets-${tag}-again`, port: 9937, workspace, outPath: join(OUT, 'after-relaunch'), profilePath: profile, env: { CODEX_HOME: codexHome }, stepFrom: 30, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
  try {
    await drive.ready()
    await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await sleep(2500)
    say(`  (relaunched, what the app says they are doing: ${JSON.stringify(await settledStates())})`)
    check('relaunched: the Team screen opens', (await drive.evaluate(team)) === 'team')
    const again = await drive.capture('Relaunched: Handheld still as drawn, the eight still puppets', async () => drive.evaluate(faces('.lc-rostergrid')))
    const faces2 = JSON.parse(String(again))
    check('relaunched, the teammate made as drawn is still as drawn, and the eight still puppets', faces2[madeId]?.face === 'pet' && faces2[madeId].puppet === '' && KEPT.every(([, teammateId]) => faces2[teammateId]?.puppet === 'on'), again)
  } catch (error) {
    failures += 1
    say(`relaunch failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed (both launches): ${String(failures)}` })
  }
}
say(`record: ${OUT}`)
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
