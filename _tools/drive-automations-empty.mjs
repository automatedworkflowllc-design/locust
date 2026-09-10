// What does the Automations screen tell a person to do?
//
//   node _tools/drive-automations-empty.mjs
//
// A first outside tester read this screen, followed it exactly, and filed
// "Automations are advertised and have no save/schedule control" as a STOP
// (2026-09-07). They were wrong about the control -- `Save as routine` exists
// and schedule-smoke proves it end to end -- and the screen is what misled
// them: it said "save it from that teammate's card" under a button reading
// "Open the team", and the control is on neither.
//
// So this reads the empty state, then performs the gesture it now names, on
// a real conversation, to check the instruction is true.
//
// Spends nothing: the conversation is seeded, no mission is sent.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-automations-ws-')
const drive = await startDrive({
  name: 'automations-empty',
  port: 9346,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const OPEN_AUTOMATIONS = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  // The sidebar's Automations section header opens the screen; its title is
  // the stable handle ("What automations are").
  const tab = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'What automations are')
    ?? [...document.querySelectorAll('button')].find((b) => /AUTOMATIONS/i.test(flat(b)))
  if (!tab) return 'no way in to the Automations screen'
  tab.click()
  await new Promise((r) => setTimeout(r, 900))
  const empty = document.querySelector('.lc-empty')
  const cli = document.querySelector('.lc-cliartifacts')
  const rows = [...document.querySelectorAll('.lc-cliartifacts__row')].map(flat)
  return 'empty state: ' + (empty ? flat(empty).slice(0, 160) : 'none')
    + ' || CLI section: ' + (cli ? rows.length + ' rows' : 'ABSENT')
    + (rows.length ? ' >> ' + rows.slice(0, 4).join('  ;;  ') : '')
})()`

try {
  await drive.capture('what the Automations empty state says', async () => {
    await drive.ready()
    return drive.evaluate(OPEN_AUTOMATIONS)
  })

  await drive.capture('and the gesture it names, performed', () =>
    drive.evaluate(`(async () => {
      const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
      const row = document.querySelector('.lc-teammate__mission')
      if (!row) return 'no conversation row in the sidebar to right-click'
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 260 }))
      await new Promise((r) => setTimeout(r, 600))
      const items = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')].map(flat)
      const save = items.find((t) => /Save as routine/i.test(t))
      return 'menu items: ' + (items.length ? items.join(' · ') : 'none')
        + ' || Save as routine: ' + (save ? 'PRESENT' : 'ABSENT')
    })()`)
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The Automations empty state, and whether the gesture it names is real.' })
}
