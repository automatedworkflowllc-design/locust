// A dialog holds the keyboard until it closes, and Escape closes it.
//
//   node _tools/probe-dialog-keyboard.mjs [--packaged]
//
// Beta review of 0.255.0, #1: tabbing through the routine editor walked out
// of it -- to the window's Minimize, Maximize and Close, then Home, Add and
// the conversation search behind the scrim -- and Escape left it open, even
// with focus in its own name field.
//
// Real key events (CDP Input.dispatchKeyEvent), so the browser's own focus
// movement is what is measured, not a synthetic event the page could treat
// differently. For each dialog: Tab 25 times and Shift+Tab 5 times, and
// focus must be inside the dialog after every one; then Escape, and the
// dialog must be gone with focus back on the button that opened it.
//
// Spends nothing: no mission is sent.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, FREE_ROUTE, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
const packaged = process.argv.includes('--packaged') && existsSync(EXE) ? EXE : undefined
say(packaged === undefined ? 'driving the LOCAL build in out/' : 'driving the PACKAGED build')

const drive = await startDrive({
  name: 'dialog-keyboard',
  port: 9357,
  ...(packaged === undefined ? {} : { packaged }),
  workspace: await scratchRepository('locust-dialog-keys-ws-'),
  sendsNothing: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  },
  files: {
    'routines.json': JSON.stringify({
      schemaVersion: 1,
      routines: [{
        routineId: 'rt_seed_1',
        name: 'Beta README check',
        teammateId: 'tm_wren',
        route: { ...FREE_ROUTE, mode: 'ask' },
        steps: ['Read the README and say what it is for.'],
        learnedFrom: [],
        createdAt: '2026-09-20T09:00:00.000Z',
        runs: 0
      }]
    })
  }
})

const key = async (name, shift = false) => {
  const code = name === 'Tab' ? 9 : 27
  const base = { key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0 }
  await drive.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  await sleep(60)
}
const where = () => drive.evaluate(`(() => {
  const dialog = document.querySelector('.lc-dialog')
  const at = document.activeElement
  return JSON.stringify({
    open: dialog !== null,
    inside: dialog !== null && dialog.contains(at),
    at: at ? (at.getAttribute('aria-label') || at.getAttribute('title') || at.tagName + ':' + (at.innerText || at.placeholder || '').slice(0, 24)) : 'nothing'
  })
})()`)

const failures = []
async function check(label, open) {
  const opener = await drive.capture(`${label}: open it`, open)
  let outside = 0
  let firstOutside
  for (let press = 0; press < 30; press += 1) {
    await key('Tab', press >= 25)
    const now = JSON.parse(await where())
    if (!now.inside) {
      outside += 1
      firstOutside ??= `${String(press + 1)}: ${now.at}`
    }
  }
  await drive.capture(`${label}: after 25 Tab and 5 Shift+Tab`, async () => `presses that left the dialog: ${String(outside)}${firstOutside ? ` (first at ${firstOutside})` : ''}`)
  if (outside > 0) failures.push(`${label}: focus left the dialog on ${String(outside)} of 30 presses (first at ${String(firstOutside)})`)
  const after = JSON.parse(await drive.capture(`${label}: Escape`, async () => {
    await key('Escape')
    await sleep(300)
    return where()
  }))
  if (after.open) failures.push(`${label}: Escape left the dialog open`)
  else if (after.at !== opener) failures.push(`${label}: focus went to "${String(after.at)}", not back to "${String(opener)}"`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await check('routine editor', () => drive.evaluate(`(async () => {
    document.querySelector('button[title^="Routines"], button[aria-label^="Routines"]')?.click()
    ;[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Routines')?.click()
    await new Promise(r => setTimeout(r, 700))
    const edit = document.querySelector('button[aria-label="Edit Beta README check"]')
    if (!edit) return 'no edit button'
    edit.focus()
    edit.click()
    await new Promise(r => setTimeout(r, 500))
    return edit.getAttribute('aria-label')
  })()`))
  await check('new teammate', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Team')?.click()
    await new Promise(r => setTimeout(r, 700))
    const add = [...document.querySelectorAll('button')].find(b => /New teammate/.test(b.innerText))
    if (!add) return 'no new teammate button'
    add.focus()
    add.click()
    await new Promise(r => setTimeout(r, 500))
    return add.getAttribute('aria-label') || add.getAttribute('title') || 'BUTTON:' + add.innerText.slice(0, 24)
  })()`))
} finally {
  await drive.finish({ intro: 'Real Tab / Shift+Tab / Escape in the routine editor and the new-teammate dialog.' })
}
for (const failure of failures) say(`[FAIL] ${failure}`)
if (failures.length === 0) say('[PASS] both dialogs held the keyboard, and Escape closed them with focus back on the opener')
process.exitCode = failures.length === 0 ? 0 : 1
