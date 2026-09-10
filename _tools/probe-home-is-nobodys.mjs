// Does the home composer message nobody, and can that conversation be
// handed to a teammate afterwards?
//
//   node _tools/probe-home-is-nobodys.mjs
//
// Colin, 2026-09-10: "the home composer should be messaging no one though,
// its no teammate selected, the rooms should be where you can select
// multiple teammates" -- and then "it just shouldnt even be there at all...
// the user should have the ability to start a convo with just a model and
// assign a teammate if theyd like."
//
// The teammate chips came in with the NO-WAY-IN change on 2026-09-10, whose
// point was that rooms had no entrance. They have one now -- `New room` in
// the sidebar, and the room's own form picks its members -- so the chips
// were buying an entrance that already exists, at the cost of preselecting
// a teammate on a screen where nobody is selected.
//
// SPENDS NOTHING. It never sends: what it reads is the composer's own state
// and the menu on a mission row.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-home-ws-')
const drive = await startDrive({
  name: 'home-is-nobodys',
  port: 9473,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-05T05:01:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } },
      { teammateId: 'tm_jim', name: 'Jimothy', hue: 'clay', role: 'Custom', roleTitle: 'Finance Bro', createdAt: '2026-09-05T05:02:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('the home composer is addressed to nobody, with no roster in it', async () => {
    await drive.ready()
    return drive.evaluate(`(() => {
      const field = document.querySelector('form.command-dock textarea')
      // Asked of the composer's CONTENTS rather than of the class names the
      // chips used to carry: a roster that came back wearing a different
      // class would still be caught, and naming a dead selector is a thing
      // this repo's own harness control refuses (rightly).
      const dock = document.querySelector('form.command-dock')
      const buttons = [...(dock?.querySelectorAll('button') ?? [])]
      const roster = ['Wren', 'Gem', 'Jimothy', 'Everyone']
      const named = buttons.filter(b => roster.some(name => b.innerText.includes(name)))
      return JSON.stringify({
        placeholder: field?.getAttribute('placeholder') ?? 'NO FIELD',
        // No teammate is offered, ticked or otherwise, inside the box.
        teammateButtonsInComposer: named.map(b => b.innerText.trim()),
        // Nothing narrates a consequence, because sending has none beyond
        // sending: no room is made, no fan-out happens.
        checkboxesInComposer: dock?.querySelectorAll('[role="checkbox"]').length ?? -1,
        // The send control is the plain one again.
        sendLabel: dock?.querySelector('button[type="submit"]')?.getAttribute('aria-label') ?? 'NO BUTTON',
        // And the way INTO a room is still on screen, which is what the
        // chips were introduced to provide.
        newRoom: [...document.querySelectorAll('button')].some(b => /New room/.test(b.innerText))
      }, null, 1)
    })()`)
  })

  await drive.capture('picking a teammate in the sidebar is still how you address one', async () => {
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Gem'))?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    return drive.evaluate(`JSON.stringify({
      placeholder: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'NO FIELD'
    }, null, 1)`)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates on the roster, nothing running, nothing sent. The home screen is read as it opens.'
  })
}
