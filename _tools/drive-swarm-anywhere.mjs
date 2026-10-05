// Can swarm be reached without the composer?
//
//   node _tools/drive-swarm-anywhere.mjs
//
// Swarm is workspace-wide, and its only control was the mark on the composer
// -- which renders on the workroom alone, and is disabled while a mission
// runs. So on Missions, Team, Settings, Rooms, Memory and Automations the
// setting could not be reached at all (audit, 2026-09-07).
//
// This opens a screen that has no composer and toggles it from the palette.
//
// Spends nothing.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-swarm-ws-')
const drive = await startDrive({
  name: 'swarm-anywhere',
  port: 9349,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const ON_SETTINGS = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  // The rail button carries a stable title; its text sits inside a span next
  // to an icon and is not a reliable handle.
  let tab
  for (let i = 0; i < 20 && tab === undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
  }
  if (!tab) return 'no Settings tab'
  tab.click()
  await new Promise((r) => setTimeout(r, 1400))
  // Swarm is on the Teammates page in Settings (settingsPages.ts).
  ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'Teammates')?.click()
  await new Promise((r) => setTimeout(r, 900))
  const headings = [...document.querySelectorAll('.lc-settings__heading')].map(flat)
  const swarmSwitch = [...document.querySelectorAll('[role=switch]')].filter((el) => {
    const section = el.closest('section, .lc-settings__section, div')
    return section !== null && /swarm/i.test(section.innerText)
  })
  return 'Settings headings: ' + headings.join(' · ').slice(0, 120)
    + ' || swarm switch on Settings: ' + (swarmSwitch.length > 0 ? 'yes' : 'NO')
})()`

const TOGGLE = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  // Swarm is on the Teammates page in Settings (settingsPages.ts).
  ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'Teammates')?.click()
  await new Promise((r) => setTimeout(r, 900))
  const heading = [...document.querySelectorAll('.lc-settings__heading')].find((h) => /^Swarm$/i.test(flat(h)))
  if (!heading) return 'no Swarm section'
  const scope = heading.closest('.lc-settings__section, section, .lc-settingline')
  const sw = scope ? scope.querySelector('[role=switch]') : null
  if (!sw) return 'no switch under Swarm'
  const before = sw.getAttribute('aria-checked')
  sw.click()
  await new Promise((r) => setTimeout(r, 1200))
  const after = (scope.querySelector('[role=switch]') ?? sw).getAttribute('aria-checked')
  return 'aria-checked ' + before + ' -> ' + after + (before !== after ? '  (it stuck)' : '  (NO CHANGE)')
})()`

try {
  await drive.capture('a screen with no composer', async () => {
    await drive.ready()
    return drive.evaluate(ON_SETTINGS)
  })

  await drive.capture('toggle it there', () => drive.evaluate(TOGGLE))

} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Whether a workspace-wide setting can be changed from a screen without a composer.' })
}
