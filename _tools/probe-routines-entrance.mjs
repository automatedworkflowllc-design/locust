// Can a person FIND how to make a routine?
//
//   node _tools/probe-routines-entrance.mjs
//
// Colin has used this app daily for a week, has read the Automations screen,
// and reported routines as a feature he had never seen. The screen named the
// right-click in prose; the design agent's rule (2026-09-10) says the
// entrance where the absence is felt must CONTAIN the entrance where the
// material is, not describe it.
//
// So this looks for the material on the screen, and for the header button on
// a finished conversation. Nothing is run and nothing is sent: the profile is
// seeded with a finished mission and the app is read.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-routines-ws-')
const drive = await startDrive({
  name: 'routines-entrance',
  port: 9461,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('the Routines shelf, on a workspace that has finished nothing', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      // The DOOR, not the section label. A label is not a way in, and the
      // first version of this probe pressed one and reported the screen
      // missing.
      const door = [...document.querySelectorAll('button')].find(n => /save one from a finished conversation/i.test(n.innerText ?? ''))
      if (!door) return 'NO WAY IN: the sidebar offers no route to the shelf'
      door.click()
      await new Promise(r => setTimeout(r, 800))
      const screen = document.querySelector('[aria-label="Routines"]')
      if (!screen) return 'NO SCREEN: aria-label Routines is not on the page'
      const head = screen.querySelector('.lc-screen__head')
      return JSON.stringify({
        titled: screen.querySelector('.lc-screen__title')?.innerText.trim(),
        headerHasChrome: head === null ? false : getComputedStyle(head).borderBottomWidth !== '0px',
        namesTheGesture: /right-click/i.test(screen.innerText),
        says: screen.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200)
      }, null, 1)
    })()`)
  })

  // The premise, OUTSIDE capture(): this must be the renamed screen, or every
  // reading below is about a screen that no longer exists.
  const titled = String(await drive.evaluate(`document.querySelector('[aria-label="Routines"] .lc-screen__title')?.innerText.trim() ?? ''`))
  if (titled !== 'Routines') throw new Error(`NOT THE SCREEN: the heading reads "${titled}"`)
  say(`  the shelf is called ${titled}`)

  await drive.capture('and Settings carries what was set up in each CLI', () => drive.evaluate(`(async () => {
    const link = [...document.querySelectorAll('button, a')].find(n => /^settings$/i.test((n.innerText ?? '').trim()))
    if (link) link.click()
    await new Promise(r => setTimeout(r, 900))
    const blocks = [...document.querySelectorAll('.lc-cliartifacts')]
    return JSON.stringify({
      blocks: blocks.length,
      underARuntimeRow: blocks.every(b => b.closest('.lc-runtimerow') !== null),
      first: blocks[0]?.innerText.replace(/\\s+/g, ' ').trim().slice(0, 160) ?? 'none'
    }, null, 1)
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate, nothing run. Only the Routines shelf and the Settings runtime rows are read.' })
}
