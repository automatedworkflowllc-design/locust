// What the Routines screen LOOKS like with routines on it.
//
//   node _tools/drive-routines-look.mjs
//   LOCUST_DRIVE_LOCAL=1 node _tools/drive-routines-look.mjs
//
// `drive-routine.mjs` proves the feature works; this one is for judging how
// it reads, which is what Colin's "atrocious" was about. Four routines are
// seeded straight into the profile so the screen is full without spending a
// run, and the measurements are the ones the 2026-09-21 design brief argued
// from: what the name and its meta actually render at, and how much vertical
// room a routine costs.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const local = process.env.LOCUST_DRIVE_LOCAL === '1'
const packaged = local || !existsSync(EXE) ? undefined : EXE
say(packaged === undefined ? 'driving the LOCAL build in out/' : 'driving the PACKAGED build')

const workspace = await scratchRepository('locust-drive-routines-look-ws-')
// Ids are capped at 64 characters by `safeId`, and a routine whose id is
// longer is dropped on read with nothing said. The first version of this
// seeded a 68-character id from a deliberately long NAME and then reported
// "3 saved" for four routines -- my seed's fault, not the app's, but it took
// a look at the store to tell which.
let nextId = 0
const made = (name, steps, hours, runs) => ({
  routineId: `rt_seed_${String((nextId += 1))}`,
  name,
  teammateId: 'tm_wren',
  route: { ...FREE_ROUTE, mode: 'ask' },
  steps,
  learnedFrom: [],
  createdAt: '2026-09-20T09:00:00.000Z',
  runs,
  ...(hours === undefined ? {} : { schedule: { kind: 'every', hours } })
})

const drive = await startDrive({
  name: 'routines-look',
  port: 9322,
  ...(packaged === undefined ? {} : { packaged }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE },
      { teammateId: 'tm_jim', name: 'Jimothy', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  },
  files: {
    'routines.json': JSON.stringify(
      {
        schemaVersion: 1,
        routines: [
          made('roth check', ['Check the Roth ladder and summarise it.'], 4, 1),
          made('morning sweep', ['Read the inbox and list what needs an answer.', 'Draft the two most urgent.'], 24, 12),
          made('release notes', ['Write the changelog entry for the newest version.'], undefined, 0),
          made('a routine with a deliberately long name to see where it gives way', ['Do the long thing.'], 6, 3)
        ]
      },
      null,
      2
    )
  }
})

/** Every routine row, with what its two halves actually render at. */
const rows = `(() => {
  const list = [...document.querySelectorAll('.lc-automations .lc-routinerow')]
  if (list.length === 0) return 'NO ROUTINE ROWS; screen reads: ' + (document.querySelector('.lc-automations')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? '(no screen)')
  const read = (node) => {
    if (!node) return null
    const style = getComputedStyle(node)
    return { size: style.fontSize, weight: style.fontWeight, colour: style.color, family: style.fontFamily.split(',')[0] }
  }
  const first = list[0]
  const box = first.getBoundingClientRect()
  return JSON.stringify({
    routines: list.length,
    rowHeight: Math.round(box.height),
    fourRoutinesCost: Math.round(list.slice(0, 4).reduce((sum, n) => sum + n.getBoundingClientRect().height, 0)),
    name: read(first.querySelector('.lc-routinerow__name')),
    meta: read(first.querySelector('.lc-routinerow__meta')),
    // The orphan: is the owner's face on the same visual line as the name?
    faceTop: Math.round(first.querySelector('.lc-face')?.getBoundingClientRect().top ?? -1),
    nameTop: Math.round(first.querySelector('.lc-routinerow__name')?.getBoundingClientRect().top ?? -1)
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open Routines', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? '').startsWith('Routines') || b.innerText.trim() === 'Routines')
    if (!button) return 'NO ROUTINES TAB'
    button.click()
    await new Promise(r => setTimeout(r, 1000))
    return document.querySelector('.lc-automations')?.innerText.replace(/\\s+/g, ' ').slice(0, 220) ?? 'screen did not open'
  })()`))
  await drive.capture('the rows, and what each half renders at', () => drive.evaluate(rows))
  await drive.capture('the face and the name share a line', () => drive.evaluate(`(() => {
    const first = document.querySelector('.lc-automations .lc-routinerow')
    if (!first) return 'no row'
    const face = first.querySelector('.lc-face')?.getBoundingClientRect()
    const name = first.querySelector('.lc-routinerow__name')?.getBoundingClientRect()
    if (!face || !name) return 'face or name missing'
    const apart = Math.round(Math.abs((face.top + face.height / 2) - (name.top + name.height / 2)))
    return apart < 14
      ? 'SAME LINE: centres ' + apart + 'px apart'
      : 'ORPHANED: the face sits ' + apart + 'px from the name it belongs to'
  })()`))
} finally {
  await drive.finish({
    intro: 'Four seeded routines on the Routines screen. Measures what the name and its meta render at, what a routine costs vertically, and whether the owner face shares a line with the name.'
  })
  say(`kept: ${drive.out}`)
}
