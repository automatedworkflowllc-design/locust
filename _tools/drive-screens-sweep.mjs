// Every screen that is not the workroom, read end to end.
//
//   node _tools/drive-screens-sweep.mjs
//
// Almost all of this session's driving has been the composer and the route
// picker, because that is where the reported bugs were. Settings, Team and
// the automations list have barely been opened, and a first outside tester
// will open all of them in their first few minutes.
//
// This clicks through each, reads what it says, and counts renderer errors.
// It changes nothing and sends no mission, so it is safe to run while
// somebody else is testing on the same machine.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-screens-ws-')
const drive = await startDrive({
  name: 'screens-sweep',
  port: 9340,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z'
      },
      {
        teammateId: 'tm_atlas',
        name: 'Atlas',
        hue: 'violet',
        role: 'Research & Briefs',
        createdAt: '2026-09-05T05:01:00.000Z'
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const openTab = (name) => `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const tab = [...document.querySelectorAll('button, a')].find((b) => flat(b) === ${JSON.stringify(name)})
  if (!tab) return 'no ${name} tab'
  tab.click()
  await new Promise((r) => setTimeout(r, 1200))
  const main = document.querySelector('.lc-screen, main, .lc-main') ?? document.body
  const text = flat(main)
  // Anything that reads as a hole rather than a screen.
  const holes = ['undefined', 'NaN', '[object Object]', 'null'].filter((bad) => text.includes(bad))
  const headings = [...document.querySelectorAll('h1, h2, h3, .lc-screen__title, .lc-settings__heading')]
    .map(flat)
    .filter((t) => t.length > 0)
    .slice(0, 10)
  return 'headings: ' + (headings.length ? headings.join(' · ') : 'none')
    + (holes.length ? '  ||  HOLES: ' + holes.join(', ') : '')
    + '  ||  length: ' + text.length
})()`

// Every control on the current screen, pressed only if it is a toggle that
// says what it is. Nothing destructive: no Delete, no Remove, no Sign out.
const READ_CONTROLS = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const buttons = [...document.querySelectorAll('button')]
    .map((b) => flat(b) || b.getAttribute('aria-label') || '')
    .filter((t) => t.length > 0)
  const disabled = [...document.querySelectorAll('button[disabled]')]
    .map((b) => flat(b) || b.getAttribute('aria-label') || '?')
  return 'controls: ' + buttons.length
    + (disabled.length ? '  ||  disabled: ' + disabled.slice(0, 8).join(' · ') : '  ||  none disabled')
})()`

try {
  await drive.capture('the app opens', async () => {
    await drive.ready()
    return drive.evaluate(READ_CONTROLS)
  })

  for (const tab of ['Team', 'Settings', 'Conversations']) {
    await drive.capture(`the ${tab} screen`, () => drive.evaluate(openTab(tab)))
    await drive.capture(`  ...its controls`, () => drive.evaluate(READ_CONTROLS))
  }

  // A disabled control is the thing the design review objects to most: "never
  // draw a control for a capability that does not exist". Worth a list.
  await drive.capture('every disabled control in the whole app', () =>
    drive.evaluate(`(async () => {
      const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
      const dead = [...document.querySelectorAll('button[disabled], [aria-disabled="true"]')].map((b) => {
        const label = flat(b) || b.getAttribute('aria-label') || '?'
        return label + (b.getAttribute('title') ? ' [' + b.getAttribute('title').slice(0, 50) + ']' : ' [no reason given]')
      })
      return dead.length === 0 ? 'none' : dead.length + ' >> ' + dead.join('  ;;  ')
    })()`)
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Team, Settings and Conversations read end to end, plus every disabled control in the app.'
  })
}
