// What the app says about Muse Code, now that it can run one.
//
//   node _tools/drive-muse-in-app.mjs
//
// Not a smoke: nothing here asserts. It opens the BUILT app on a throwaway
// profile and keeps what the screen showed -- Settings' Muse Code row, and
// the route picker's Muse group with the modes offered beside it. Judging is
// done afterwards by reading the record under docs/user-session/.
//
// The thing worth looking at: until 0.247.0 the row read
// "Muse Code 1.3.0 · PLANNED · Not built yet", and the picker offered it as
// unselectable. It should now read PREVIEW, be selectable, and offer Ask,
// Accept edits and Plan -- and NOT Auto.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

// The PACKAGED build, because that is what anybody installs.
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say('no packaged build at ' + EXE + ' -- run node _tools/ship.mjs first')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-muse-ws-')
const drive = await startDrive({
  name: 'muse-in-app',
  port: 9317,
  packaged: EXE,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

/** The Settings row for a runtime, by the name printed on it. */
const settingsRow = (name) => `(async () => {
  // The button's title has moved before. Find it by what it says, and say
  // what was there when it is not found.
  const buttons = [...document.querySelectorAll('button')]
  const settings = buttons.find(b => /settings/i.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
  if (!settings) return 'no Settings control; titles seen: ' + buttons.map(b => b.getAttribute('title') ?? b.getAttribute('aria-label') ?? b.innerText.trim()).filter(Boolean).join(' / ').slice(0, 400)
  settings.click()
  await new Promise(r => setTimeout(r, 1200))
  // Settings is paged, and Runtimes is not the page it opens on.
  const page = [...document.querySelectorAll('button, a, [role=tab]')].find(n => n.innerText.trim() === 'Runtimes')
  if (!page) return 'no Runtimes page in Settings; pages seen: ' + [...document.querySelectorAll('button, [role=tab]')].map(n => n.innerText.trim()).filter(Boolean).join(' / ').slice(0, 300)
  page.click()
  await new Promise(r => setTimeout(r, 1200))
  const rows = [...document.querySelectorAll('.lc-runtimerow')]
    .map(node => node.innerText?.replace(/\\s+/g, ' ').trim() ?? '')
    .filter(text => text.startsWith(${JSON.stringify(name)}))
  if (rows.length > 0) return rows[0].slice(0, 260)
  const all = [...document.querySelectorAll('.lc-runtimerow')].map(n => n.innerText.replace(/\s+/g, ' ').trim().slice(0, 40))
  return 'NO ROW FOUND for ${name}; rows present: ' + (all.join(' | ').slice(0, 1200) || '(none)')
})()`


/** Read a row with the Runtimes page already open. */
const rowNow = (name) => `(() => {
  const rows = [...document.querySelectorAll('.lc-runtimerow')]
    .map(node => node.innerText?.replace(/\s+/g, ' ').trim() ?? '')
  const found = rows.find(text => text.startsWith(${JSON.stringify(name)}))
  return found ?? ('NO ROW for ${name}; rows present: ' + (rows.map(r => r.slice(0, 40)).join(' | ').slice(0, 1200) || '(none)'))
})()`

/** Every group and row the picker draws, so Muse can be found among them. */
const pickerGroups = `(async () => {
  // Back out of Settings first: the picker does not exist on that screen.
  const home = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? '') === 'Home')
  home?.click()
  document.querySelector('.lc-brand__lockup')?.click()
  await new Promise(r => setTimeout(r, 1200))
  const buttons = [...document.querySelectorAll('button')]
  const message = buttons.find(b => /Wren/.test(b.getAttribute('title') ?? b.getAttribute('aria-label') ?? ''))
  // A miss has to SAY what was there instead, or the next step reports the
  // screen it happens to be on as if it were the screen it asked for.
  if (!message) return 'no teammate button; titles seen: ' + buttons.map(b => b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '').filter(Boolean).join(' / ').slice(0, 400)
  message.click()
  await new Promise(r => setTimeout(r, 600))
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  control.click()
  await new Promise(r => setTimeout(r, 900))
  const text = document.querySelector('[role=listbox]')?.innerText.replace(/\\s+/g, ' ') ?? '(no listbox)'
  const muse = text.match(/Muse[^|]{0,200}/)?.[0] ?? '(no Muse group)'
  return 'MUSE: ' + muse + ' || ALL: ' + text.slice(0, 700)
})()`

/** The modes offered, with the picker still open on a Muse row. */
const museModes = `(async () => {
  const rows = [...document.querySelectorAll('[role=listbox] [role=option], [role=listbox] button')]
  const row = rows.find(r => /muse/i.test(r.innerText))
  if (!row) return 'no Muse row in the picker'
  const disabled = row.getAttribute('aria-disabled') === 'true' || row.disabled === true
  row.click()
  await new Promise(r => setTimeout(r, 800))
  const mode = document.querySelector('button[aria-label="Permission mode"], button[title="Permission mode"]')
  if (!mode) return 'row was ' + (disabled ? 'DISABLED' : 'selectable') + ', but there is no mode control'
  mode.click()
  await new Promise(r => setTimeout(r, 500))
  const offered = [...document.querySelectorAll('[role=menuitemradio]')].map(b => ({
    label: b.innerText.replace(/\\s+/g, ' ').trim().split(' ')[0],
    off: b.getAttribute('aria-disabled') === 'true' || b.disabled === true
  }))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return 'row was ' + (disabled ? 'DISABLED' : 'selectable')
    + ' || offered: ' + offered.map(o => o.label + (o.off ? ' (off)' : '')).join(', ')
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Settings, Runtimes: the Muse Code row', () => drive.evaluate(settingsRow('Muse Code')))
  // The version probe reaches muse through a PowerShell launcher and is slow
  // to answer on a cold profile, so the first look can catch it CHECKING.
  // Looking once more is what a person does; reporting the first look as the
  // final state would be reporting a stopwatch as a verdict.
  await drive.capture('the same row, after discovery has had longer', async () => {
    await new Promise((resolve) => setTimeout(resolve, 12_000))
    return drive.evaluate(rowNow('Muse Code'))
  })
  await drive.capture('the OpenCode row beside it, as a control', () => drive.evaluate(rowNow('OpenCode')))
  await drive.capture('the route picker: where Muse sits', () => drive.evaluate(pickerGroups))
  await drive.capture('Muse Code: selectable, and which modes', () => drive.evaluate(museModes))
} finally {
  await drive.finish({ intro: 'Muse Code in the packaged 0.247.0 build: what Settings says about it, and what the route picker offers.' })
  say(`kept: ${drive.out}`)
}
