// What the Rooms screen says while you are building a room.
//
//   LOCUST_DRIVE_LOCAL=1 node _tools/drive-rooms-look.mjs
//
// Judging how it reads, which is what Colin's "atrocious" covered. Three
// things the 2026-09-21 design brief argued about, measured here instead:
// whether the screen title and the block heading are the same rank, whether
// the paragraph has a measure, and -- the one that matters -- whether a
// disabled Create room says why in each of its three states.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const local = process.env.LOCUST_DRIVE_LOCAL === '1'
const packaged = local || !existsSync(EXE) ? undefined : EXE
say(packaged === undefined ? 'driving the LOCAL build in out/' : 'driving the PACKAGED build')

const workspace = await scratchRepository('locust-drive-rooms-look-ws-')
const mate = (id, name, hue) => ({
  teammateId: id,
  name,
  hue,
  role: 'Code & Migrations',
  createdAt: '2026-09-05T05:00:00.000Z',
  route: FREE_ROUTE
})

const drive = await startDrive({
  name: 'rooms-look',
  port: 9323,
  ...(packaged === undefined ? {} : { packaged }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [mate('tm_wren', 'Wren', 'lime'), mate('tm_jim', 'Jimothy', 'blue'), mate('tm_ada', 'Ada', 'violet')],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const openRooms = `(async () => {
  const button = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? '').startsWith('Rooms') || b.innerText.trim() === 'Rooms')
  if (!button) return 'NO ROOMS TAB'
  button.click()
  await new Promise(r => setTimeout(r, 1000))
  return document.querySelector('.lc-screen')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'screen did not open'
})()`

/** The two titles, and whether one reads as belonging to the other. */
const ranks = `(() => {
  const screen = document.querySelector('.lc-screen__title')
  const block = document.querySelector('.lc-settings__heading')
  if (!screen || !block) return 'titles missing'
  const read = (n) => { const s = getComputedStyle(n); return { text: n.innerText.trim(), size: s.fontSize, weight: s.fontWeight, colour: s.color } }
  const a = read(screen)
  const b = read(block)
  const lede = document.querySelector('.lc-settings__lede')
  const width = lede === null ? null : Math.round(lede.getBoundingClientRect().width)
  return JSON.stringify({
    screenTitle: a,
    blockHeading: b,
    sameRank: a.size === b.size && a.weight === b.weight,
    ledeWidthPx: width
  })
})()`

/** Type a name, tick nobody, tick one: what does the form say each time? */
const states = `(async () => {
  const field = document.querySelector('.lc-roomform__name')
  if (!field) return 'NO ROOM FORM'
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const submit = () => [...document.querySelectorAll('.lc-roomform button[type=submit]')][0]
  const note = () => document.querySelector('.lc-roomform .lc-settings__note')?.innerText.replace(/\\s+/g, ' ').trim() ?? '(nothing said)'
  const chips = [...document.querySelectorAll('.lc-roomform__members [role=checkbox]')]
  const seen = []

  const look = (label) => seen.push(label + ': disabled=' + String(submit()?.disabled) + ' · says "' + note() + '"')

  look('empty name, nobody ticked')
  setter.call(field, 'standup')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  look('named, nobody ticked')
  chips[0]?.click()
  await new Promise(r => setTimeout(r, 300))
  look('named, one ticked')
  const count = document.querySelector('.lc-roomform__count')?.innerText.trim() ?? '(no count)'
  return seen.join(' || ') + ' || count reads: ' + count
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open Rooms', () => drive.evaluate(openRooms))
  await drive.capture('the two titles, and the measure', () => drive.evaluate(ranks))
  await drive.capture('THE SILENT DISABLE: what the form says in each state', () => drive.evaluate(states))
} finally {
  await drive.finish({
    intro: 'The Rooms screen with three teammates and no rooms yet. Reads the screen title against the block heading, the paragraph measure, and what a disabled Create room says in each of the three states that disable it.'
  })
  say(`kept: ${drive.out}`)
}
