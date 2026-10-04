// What the app says about Muse Code, now that it can run one.
//
//   node _tools/drive-muse-in-app.mjs
//
// Not a smoke: nothing here asserts. It opens the PACKAGED app on a throwaway
// profile and keeps what the screen showed -- Settings' Muse Code row, the
// route picker's Muse group, and the modes offered once it is chosen. The
// judging is done afterwards by reading the record under docs/user-session/.
//
// This drive is why 0.247.0 is not wrong. It first read
// "Muse Code 1.3.0 · CHECKING · did not answer its version probe in time",
// which is how two defects were found that every unit test had passed over:
// a readiness regex with a doubled escape, and a capability probe pointed at
// the wrong help page.
//
// Every step says what it found INSTEAD when a selector misses. That rule
// found the Settings paging and the teammate button's renamed title, both of
// which would otherwise have been reported as the product doing nothing.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

// The PACKAGED build, because that is what anybody installs.
const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE} -- run node _tools/ship.mjs first`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-muse-ws-')
const drive = await startDrive({
  name: 'muse-in-app',
  port: 9317,
  // Set only when this drive is asked to stand in for a signed-in machine.
  env: process.env.LOCUST_FAKE_MUSE_KEY === undefined ? {} : { META_API_KEY: process.env.LOCUST_FAKE_MUSE_KEY },
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

const openRuntimesPage = `(async () => {
  const buttons = [...document.querySelectorAll('button')]
  const settings = buttons.find(b => /settings/i.test((b.getAttribute('title') ?? '') + ' ' + b.innerText))
  if (!settings) return 'no Settings control; titles seen: ' + buttons.map(b => b.getAttribute('title') ?? b.innerText.trim()).filter(Boolean).join(' / ').slice(0, 400)
  settings.click()
  await new Promise(r => setTimeout(r, 1200))
  // Settings is paged, and Runtimes is not the page it opens on.
  const page = [...document.querySelectorAll('button, a, [role=tab]')].find(n => n.innerText.trim() === 'AI agents')
  if (!page) return 'no Runtimes page; pages seen: ' + [...document.querySelectorAll('button, [role=tab]')].map(n => n.innerText.trim()).filter(Boolean).join(' / ').slice(0, 300)
  page.click()
  await new Promise(r => setTimeout(r, 1200))
  return 'Runtimes page open'
})()`

/** A Settings runtime row, with that page already open. */
const runtimeRow = (name) => `(() => {
  const rows = [...document.querySelectorAll('.lc-runtimerow')].map(node => node.innerText.replace(/[\\r\\n]+/g, ' ').trim())
  const found = rows.find(text => text.indexOf(${JSON.stringify(name)}) === 0)
  if (found !== undefined) return found.slice(0, 260)
  return 'NO ROW for ${name}; rows present: ' + (rows.map(r => r.slice(0, 30)).join(' | ').slice(0, 600) || '(none)')
})()`

/** Open Wren's composer and its route picker. */
const openPicker = `(async () => {
  // Out of Settings, and back to the team. Both of these reach it; the
  // lockup alone did not after a Settings page had been opened.
  const home = [...document.querySelectorAll('button')].find(b => (b.getAttribute('title') ?? '') === 'Home')
  home?.click()
  await new Promise(r => setTimeout(r, 1200))
  document.querySelector('.lc-brand__lockup')?.click()
  await new Promise(r => setTimeout(r, 1500))
  const routeControl = () => [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  // Home may land straight in Wren's conversation, which already HAS the
  // composer -- so only go looking for a teammate to open when it does not.
  if (routeControl() === undefined) {
    const message = [...document.querySelectorAll('button')].find(b => /Wren/.test(b.getAttribute('title') ?? ''))
    if (!message) return 'no composer and no teammate button; titles seen: ' + [...document.querySelectorAll('button')].map(b => b.getAttribute('title') ?? '').filter(Boolean).join(' / ').slice(0, 800)
    message.click()
    await new Promise(r => setTimeout(r, 900))
  }
  const control = routeControl()
  if (!control) return 'no route control'
  control.click()
  await new Promise(r => setTimeout(r, 900))
  // The picker is a dialog, not a listbox: role="dialog" on .lc-picker.
  const picker = document.querySelector('.lc-picker')
  if (!picker) return 'the picker did not open'
  const muse = picker.innerText.replace(/\\s+/g, ' ').match(/MUSE CODE.{0,200}/)
  return muse === null
    ? 'no Muse group; groups seen: ' + [...picker.querySelectorAll('.lc-picker__group')].map(g => g.innerText.trim()).join(' / ').slice(0, 300)
    : 'MUSE GROUP: ' + muse[0]
})()`

/** Choose the Muse row, then read the modes the composer offers. */
const chooseMuseAndReadModes = `(async () => {
  const list = document.querySelector('.lc-picker__list')
  if (!list) return 'the picker is not open'
  // Rows carry the model; the group heading above carries the runtime. Walk
  // the list keeping the heading in hand, so the right row is chosen.
  let heading = ''
  let target
  for (const node of list.querySelectorAll('.lc-picker__group, .lc-picker__row')) {
    if (node.classList.contains('lc-picker__group')) heading = node.innerText.trim()
    else if (/muse/i.test(heading)) { target = node; break }
  }
  if (!target) return 'no row under a Muse heading'
  const disabled = target.getAttribute('aria-disabled') === 'true' || target.disabled === true
  target.click()
  await new Promise(r => setTimeout(r, 1000))
  const mode = document.querySelector('button[aria-label="Permission mode"], button[title="Permission mode"]')
  if (!mode) return 'row was ' + (disabled ? 'DISABLED' : 'selectable') + ', but there is no mode control'
  mode.click()
  await new Promise(r => setTimeout(r, 600))
  const offered = [...document.querySelectorAll('[role=menuitemradio]')].map(b => {
    const label = b.innerText.replace(/\\s+/g, ' ').trim()
    const off = b.getAttribute('aria-disabled') === 'true' || b.disabled === true
    return label.split(' · ')[0] + (off ? ' (OFF)' : '')
  })
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const route = document.querySelector('.lc-control')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
  return 'row was ' + (disabled ? 'DISABLED' : 'selectable')
    + ' || composer now on: ' + route
    + ' || modes: ' + (offered.join(', ') || '(none)')
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Settings: open the Runtimes page', () => drive.evaluate(openRuntimesPage))
  await drive.capture('the Muse Code row', () => drive.evaluate(runtimeRow('Muse Code')))
  await drive.capture('the OpenCode row beside it, as a control', () => drive.evaluate(runtimeRow('OpenCode')))
  await drive.capture('the route picker: where Muse sits', () => drive.evaluate(openPicker))
  await drive.capture('choose Muse Code, and see which modes it offers', () => drive.evaluate(chooseMuseAndReadModes))
} finally {
  await drive.finish({ intro: 'Muse Code in the packaged 0.247.0 build: what Settings says about it, and what the route picker and the mode menu offer.' })
  say(`kept: ${drive.out}`)
}
