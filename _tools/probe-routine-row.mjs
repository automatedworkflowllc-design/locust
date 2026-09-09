// Are Run and Edit drawn on top of each other in a teammate's Routines row?
//
//   node _tools/probe-routine-row.mjs
//
// The Team screen's ROUTINES row renders "Run" and "Edit" as overlapping
// glyphs -- seen at 3x in the 2026-09-09 routine drive, reading as "REdit"
// inside one bordered box, with "Remove" beside it in another. The row also
// ends "every 4 hours ·" with a dangling separator and nothing after it.
//
// Reasoning about the CSS did not settle it -- the grid declares four columns
// (`auto minmax(0, 1fr) auto auto`) while the comment beside it says three,
// and the row has three children -- so this MEASURES instead: it reads the
// bounding box of every button in the row and reports whether any two overlap.
//
// A routine is written straight into the profile, so nothing runs and no model
// is called. Costs nothing and takes seconds.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, say, scratchRepository, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE}`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-routinerow-ws-')
const now = new Date().toISOString()

const drive = await startDrive({
  name: 'routine-row',
  port: 9431,
  packaged: EXE,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: {
    // Written before launch, so the app reads it at boot. No mission is ever
    // started: the row only needs a routine to exist.
    'routines.json': {
      schemaVersion: 1,
      routines: [
        {
          routineId: 'rt_probe',
          name: 'Reply with exactly the word ALPHA and nothing else.',
          teammateId: 'tm_wren',
          route: { runtime: 'opencode', model: 'account-default', mode: 'ask' },
          steps: ['Reply with exactly the word ALPHA and nothing else.'],
          learnedFrom: [],
          createdAt: now,
          runs: 1,
          schedule: { kind: 'every', hours: 4 }
        }
      ]
    }
  }
})

/** Every button in the routines row, with its box, and any pair that overlaps. */
const MEASURE = `(async () => {
  document.querySelector('button[title="Team (Ctrl 2)"]')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  const row = document.querySelector('.lc-routinerow')
  if (row === null) return JSON.stringify({ error: 'no routine row on the Team screen' })
  const buttons = [...row.querySelectorAll('button')].map((el) => {
    const b = el.getBoundingClientRect()
    return { text: (el.textContent ?? '').trim(), left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), width: Math.round(b.width) }
  })
  const overlaps = []
  for (let i = 0; i < buttons.length; i += 1) {
    for (let j = i + 1; j < buttons.length; j += 1) {
      const a = buttons[i]
      const b = buttons[j]
      const sharesX = a.left < b.right && b.left < a.right
      const sharesY = Math.abs(a.top - b.top) < 12
      if (sharesX && sharesY) overlaps.push(a.text + ' overlaps ' + b.text)
    }
  }
  const styles = getComputedStyle(row)
  return JSON.stringify({
    overlaps,
    display: styles.display,
    cols: styles.gridTemplateColumns,
    kids: row.children.length,
    kidClasses: [...row.children].map((el) => String(el.className || el.tagName)).join(' + '),
    buttons,
    gridTemplateColumns: styles.gridTemplateColumns,
    childCount: row.children.length,
    children: [...row.children].map((el) => el.className || el.tagName),
    rowText: (row.innerText ?? '').replace(/\\s+/g, ' ').trim()
  })
})()`

try {
  await drive.capture('measure the routines row on the Team screen', async () => {
    await drive.ready()
    return drive.evaluate(MEASURE)
  })
} finally {
  await drive.finish({ intro: 'A routine written straight into the profile. Nothing is run and no model is called.' })
}

say('done')
