// Codex Buddy with a screen for a face (2026-10-05, petScreens.ts), on the real
// app: a teammate wearing him shows the screen in the sidebar and on the Team
// screen, one asked for as drawn does not; pointed at, he wakes (a wave, the
// glad eyes) and then rests, drawing nothing; Terminal faces off takes the
// screen away and on gives it back; and a new teammate's look offers him As
// drawn or Screen, the choice kept through a relaunch.
//
//   node _tools/drive-buddy-screen.mjs [--packaged <exe>] [--tag <name>] [--out <dir>] [--sheet <folder>]
//
// His sheet is his maker's (openpets.dev): never in this repository, and so
// never in this drive's record either -- the record is kept outside it
// (LOCUST_DRIVE_OUT, or a folder in the system's temp) unless --out says where.
// The sheet is the copy Locust downloaded on this computer, its pets folder in
// Locust's own userData (%APPDATA%\@teammate\desktop\pets\codex-buddy, or
// --sheet), COPIED into the drive's scratch profile; a scratch CODEX_HOME keeps
// the real ~/.codex/pets out of it. Without his sheet on this computer, pick
// him once in Locust (or run drive-pet-picks.mjs) first. Sends nothing.

import { copyFile, mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const SHEET = arg('--sheet') ?? join(process.env.APPDATA ?? '', '@teammate', 'desktop', 'pets', 'codex-buddy')
const OUT = arg('--out') ?? join(process.env.LOCUST_DRIVE_OUT ?? join(tmpdir(), 'locust-drive-records'), 'buddy-screen-2026-10-05', tag)

try {
  await stat(join(SHEET, 'spritesheet.webp'))
} catch {
  say(`No Codex Buddy sheet at ${SHEET}: pick him once in Locust (Pets, in a teammate's look), or give --sheet <folder>.`)
  process.exit(2)
}
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-buddy-'))
await mkdir(join(profile, 'pets', 'codex-buddy'), { recursive: true })
await copyFile(join(SHEET, 'spritesheet.webp'), join(profile, 'pets', 'codex-buddy', 'spritesheet.webp'))
await copyFile(join(SHEET, 'pet.json'), join(profile, 'pets', 'codex-buddy', 'pet.json'))
// Empty: the real ~/.codex/pets is never read.
const codexHome = await mkdtemp(join(tmpdir(), 'locust-drive-buddy-codex-'))

const at = '2026-10-05T09:00:00.000Z'
const wearing = (screen) => ({ headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' }, pet: { source: 'gallery', id: 'codex-buddy', ...(screen === undefined ? {} : { screen }) } })
const seed = {
  schemaVersion: 1,
  teammates: [
    { teammateId: 'tm_buddy', name: 'Buddy', hue: 'blue', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE, avatar: wearing(undefined) },
    { teammateId: 'tm_drawn', name: 'Drawn', hue: 'lime', role: 'Docs & QA', createdAt: at, route: FREE_ROUTE, avatar: wearing(false) }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}
const workspace = await scratchRepository('locust-drive-buddy-ws-')
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}

// Every teammate face in a part of the window: what it wears, whether it wears his screen, its move and eyes, and whether it drew.
const faces = (scope = 'body') => `(async () => {
  await new Promise((r) => setTimeout(r, 900))
  const out = {}
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
    out[host.dataset.teammate] = {
      face: canvas?.dataset.face ?? 'none',
      pet: host.dataset.pet ?? '',
      screen: canvas?.dataset.screen ?? '',
      move: canvas?.dataset.move ?? '',
      eyes: canvas?.dataset.eyes ?? '',
      rig: canvas?.dataset.rig ?? '',
      lift: canvas?.dataset.lift ?? '',
      size: Math.round(box.width),
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
// His face on the Team screen, made to count the frames it draws (each frame clears its canvas once).
const countBuddy = `(() => {
  const canvas = document.querySelector('.lc-rostergrid [data-teammate="tm_buddy"] canvas[data-screen="on"]')
  if (!canvas) return 'no screen'
  const context = canvas.getContext('2d')
  if (!context.__counted) {
    const clear = context.clearRect.bind(context)
    window.__buddyFrames = 0
    context.clearRect = (...rect) => { window.__buddyFrames += 1; return clear(...rect) }
    context.__counted = true
  }
  return 'counting'
})()`
const frames = async () => Number(await drive.evaluate('window.__buddyFrames ?? -1'))
// The pointer on his face, as React hears it, or away again.
const point = (on) => `(() => {
  const host = document.querySelector('.lc-rostergrid .lc-bot[data-teammate="tm_buddy"]')
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
  pets?.querySelector('[role=radio][data-pet="codex-buddy"]')?.click()
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
    screen: preview?.dataset.screen ?? '',
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
 * At rest before the checks that need him at rest. A launch can count every
 * teammate as stuck for its first seconds, until its runtimes are found
 * (status.ts) -- and his face rightly says so, under the bar -- so the drive
 * waits for what the app says he is doing, not for a fixed time.
 */
const restingSoon = async (seconds = 40) => {
  let state = ''
  for (let i = 0; i < seconds * 2; i += 1) {
    state = String(await drive.evaluate(`document.querySelector('.lc-bot[data-teammate="tm_buddy"] canvas[data-face="pet"]')?.dataset.petState ?? ''`))
    if (state === 'idle') return state
    await sleep(500)
  }
  return state
}

// A teammate's id, from the sidebar's row of faces (each named in its label).
const idOf = (name) => `(() => [...document.querySelectorAll('.lc-faces__one')].find((face) => (face.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(name)}))?.querySelector('[data-teammate]')?.dataset.teammate ?? '')()`

let drive = await startDrive({ name: `buddy-screen-${tag}`, port: 9935, workspace, outPath: OUT, keep: true, seed, profilePath: profile, env: { CODEX_HOME: codexHome }, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
let madeId = ''
try {
  await drive.ready()
  // An automated window is not the focused one; a face rightly holds still while the window is behind others.
  await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  const settledState = await restingSoon()
  say(`  (what the app says he is doing: ${settledState}${settledState === 'idle' ? '' : ' -- his runtime has not answered yet (Home, Connected accounts); his face says so, and the checks below expect that'})`)
  await sleep(2500)

  const sidebar = await read('.lc-sidebar')
  await drive.capture('The sidebar: Buddy with his screen, Drawn as drawn', async () => JSON.stringify(sidebar))
  const expected = settledState === 'idle' ? { move: 'rest', eyes: '||' } : { move: 'stuck', eyes: '><' }
  check(`in the sidebar, a teammate wearing him wears the screen, saying what he is doing (${expected.move})`, sidebar.tm_buddy?.face === 'pet' && sidebar.tm_buddy.screen === 'on' && sidebar.tm_buddy.move === expected.move && sidebar.tm_buddy.eyes === expected.eyes && sidebar.tm_buddy.painted >= 15, JSON.stringify(sidebar.tm_buddy))
  check('one whose look asks for him as drawn wears his own face', sidebar.tm_drawn?.face === 'pet' && sidebar.tm_drawn.pet === 'codex-buddy' && sidebar.tm_drawn.screen === '' && sidebar.tm_drawn.painted >= 15, JSON.stringify(sidebar.tm_drawn))

  check('the Team screen opens', (await drive.evaluate(team)) === 'team')
  const roster = await read('.lc-rostergrid')
  check('wearing the screen, he moves on his own rig: his body cut from his sheet, his arms drawn by Locust', roster.tm_buddy?.rig === 'on', JSON.stringify(roster.tm_buddy))
  check('on the Team screen, the same: his screen on one card, his own face on the other', roster.tm_buddy?.screen === 'on' && roster.tm_drawn?.screen === '' && roster.tm_buddy.size >= 28, JSON.stringify(roster))

  // At rest he draws nothing; pointed at, he wakes -- a wave, glad eyes -- and then rests again.
  check('his face can be counted', (await drive.evaluate(countBuddy)) === 'counting')
  await sleep(2000)
  const resting = await frames()
  await sleep(3000)
  check('at rest he draws nothing', (await frames()) === resting, `${String(resting)} -> ${String(await frames())}`)
  await drive.evaluate(point(true))
  await sleep(700)
  const noticed = await drive.capture(`Buddy pointed at (${expected.move})`, async () => JSON.stringify((await read('.lc-rostergrid')).tm_buddy))
  const woke = JSON.parse(String(noticed))
  if (settledState === 'idle') check('pointed at, at rest, he waves with glad eyes', woke.move === 'wave' && woke.eyes === '^^', noticed)
  else check('pointed at while stuck, he stays stuck: what a teammate is doing wins over the pointer', woke.move === 'stuck' && woke.eyes === '><', noticed)
  check('awake, he draws', (await frames()) > resting, `${String(resting)} -> ${String(await frames())}`)
  await drive.evaluate(point(false))
  await sleep(3500)
  const settled = await frames()
  await sleep(2500)
  const after = await read('.lc-rostergrid')
  check('left alone, he rests again and draws nothing', (await frames()) === settled && after.tm_buddy?.move === expected.move && after.tm_buddy.eyes === expected.eyes, `${String(settled)} -> ${String(await frames())} ${JSON.stringify(after.tm_buddy)}`)

  // Terminal faces: off takes the screen away, on gives it back.
  check('Terminal faces turns off', (await drive.evaluate(terminalFaces('Off'))) === 'Off')
  check('the Team screen opens again', (await drive.evaluate(team)) === 'team')
  const off = await read('body')
  check('with Terminal faces off he wears his own face everywhere', off.tm_buddy?.face === 'pet' && off.tm_buddy.screen === '', JSON.stringify(off.tm_buddy))
  check('Terminal faces turns on', (await drive.evaluate(terminalFaces('On'))) === 'On')
  check('the Team screen opens once more', (await drive.evaluate(team)) === 'team')
  const on = await read('body')
  check('on again, his screen is back', on.tm_buddy?.screen === 'on', JSON.stringify(on.tm_buddy))

  // A new teammate's look: picking him offers As drawn or Screen.
  check('New teammate opens with him picked', (await drive.evaluate(openNewTeammate)) === 'open')
  const picked = JSON.parse(String(await drive.capture('New teammate: Codex Buddy picked, his face choice', async () => drive.evaluate(lookFace))))
  check('his look offers As drawn or Screen, the screen chosen, the preview wearing it', picked.choices.join('|') === 'As drawn|Screen' && picked.chosen === 'Screen' && picked.preview === 'pet' && picked.screen === 'on', JSON.stringify(picked))
  check('As drawn can be chosen', (await drive.evaluate(choose('As drawn'))) === 'clicked')
  const drawn = JSON.parse(String(await drive.capture('New teammate: As drawn chosen', async () => drive.evaluate(lookFace))))
  check('chosen as drawn, the preview wears his own face', drawn.chosen === 'As drawn' && drawn.preview === 'pet' && drawn.screen === '', JSON.stringify(drawn))
  const made = await drive.evaluate(nameAndCreate('Lifter'))
  check('a teammate wearing him as drawn is made', made === 'created', made)
  madeId = String(await drive.evaluate(idOf('Lifter')))
  const made1 = (await read('body'))[madeId]
  check('the new teammate wears him as drawn', madeId !== '' && made1?.face === 'pet' && made1.screen === '', `${madeId} ${JSON.stringify(made1)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Codex Buddy's screen: sidebar, Team screen, pointed at and at rest, Terminal faces off and on, his look's choice. His sheet copied into a scratch profile; a scratch CODEX_HOME.`, extra: `Checks failed (first launch): ${String(failures)}` })
}

// Relaunched on the same profile: the choice is kept with the teammate.
if (madeId !== '') {
  drive = await startDrive({ name: `buddy-screen-${tag}-again`, port: 9935, workspace, outPath: join(OUT, 'after-relaunch'), profilePath: profile, env: { CODEX_HOME: codexHome }, stepFrom: 30, sendsNothing: true, ...(packaged === undefined ? {} : { packaged }) })
  try {
    await drive.ready()
    await drive.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await sleep(2500)
    const state2 = await restingSoon()
    say(`  (relaunched, what the app says he is doing: ${state2})`)
    const again = await drive.capture('Relaunched: Lifter still as drawn, Buddy still with his screen', async () => drive.evaluate(faces('body')))
    const faces2 = JSON.parse(String(again))
    check('relaunched, the teammate made as drawn is still as drawn, and Buddy still wears his screen', faces2[madeId]?.face === 'pet' && faces2[madeId].screen === '' && faces2.tm_buddy?.screen === 'on', again)
    if (state2 === 'idle') {
      check('relaunched: the Team screen opens', (await drive.evaluate(team)) === 'team')
      check('relaunched: his face can be counted', (await drive.evaluate(countBuddy)) === 'counting')
      await sleep(2000)
      const still = await frames()
      await sleep(3000)
      check('relaunched, at rest he draws nothing', (await frames()) === still, `${String(still)} -> ${String(await frames())}`)
      await drive.evaluate(point(true))
      await sleep(700)
      const waved = JSON.parse(String(await drive.capture('Relaunched: Buddy pointed at, at rest', async () => JSON.stringify((await read('.lc-rostergrid')).tm_buddy))))
      check('relaunched, pointed at, at rest, he waves with glad eyes', waved.move === 'wave' && waved.eyes === '^^', JSON.stringify(waved))
      check('relaunched, awake, he draws', (await frames()) > still, `${String(still)} -> ${String(await frames())}`)
      await drive.evaluate(point(false))
      await sleep(3500)
      const done = await frames()
      await sleep(2500)
      const rested = (await read('.lc-rostergrid')).tm_buddy
      check('relaunched, left alone, he rests again and draws nothing', (await frames()) === done && rested?.move === 'rest' && rested.eyes === '||', `${String(done)} -> ${String(await frames())} ${JSON.stringify(rested)}`)
    } else {
      say('  (his runtime still has not answered: the wave at rest is not checked on this machine now)')
    }
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
