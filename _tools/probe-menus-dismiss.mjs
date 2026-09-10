// Open a menu, then click somewhere else. Does it close?
//
//   node _tools/probe-menus-dismiss.mjs
//
// "for selecting the effort level and model, you to click out of it you have
// to click the button again instead of just clicking anywhere on the page"
// -- the first outside tester, on 0.55.0.
//
// Three panels hang off the composer: the permission mode menu, the effort
// panel and the route picker. None of them closed on an outside press, while
// ContextMenu and RailFlyout in the same app always have. This presses each
// one open and then clicks the thread behind it, which is the gesture that
// was reported.
//
// Runs no model and spends nothing: it only opens and closes menus.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-menus-ws-')
const drive = await startDrive({
  name: 'menus-dismiss',
  port: 9444,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/**
 * Open one panel, click the thread behind it, and say what happened.
 *
 * `panel` is what being open looks like on screen. The click is a real
 * mousedown/mouseup pair on the thread, because the close listens for
 * mousedown in the capture phase and a bare `.click()` does not send one.
 */
const openThenClickAway = (label, control, panel) => drive.evaluate(`(async () => {
  const trigger = ${control}
  if (!trigger) return '${label}: no control to open'
  trigger.click()
  await new Promise(r => setTimeout(r, 500))
  const opened = document.querySelector('${panel}') !== null
  if (!opened) return '${label}: the control did not open anything'

  const elsewhere = document.querySelector('.lc-thread') ?? document.body
  const box = elsewhere.getBoundingClientRect()
  const x = Math.round(box.left + box.width / 2)
  const y = Math.round(box.top + 40)
  for (const type of ['mousedown', 'mouseup', 'click']) {
    elsewhere.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }
  await new Promise(r => setTimeout(r, 400))
  const stillOpen = document.querySelector('${panel}') !== null
  return '${label}: closed on a click elsewhere: ' + !stillOpen
})()`)

/** And the control still toggles, which the capture-phase close could break. */
const toggles = (label, control, panel) => drive.evaluate(`(async () => {
  const trigger = ${control}
  if (!trigger) return '${label}: no control'
  trigger.click()
  await new Promise(r => setTimeout(r, 400))
  const openedAgain = document.querySelector('${panel}') !== null
  trigger.click()
  await new Promise(r => setTimeout(r, 400))
  const closedAgain = document.querySelector('${panel}') === null
  return '${label}: reopens: ' + openedAgain + ' · its own button still closes it: ' + closedAgain
})()`)

const MODE = `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')`
const ROUTE = `[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')`
const EFFORT = `[...document.querySelectorAll('button')].find(b => /effort/i.test(b.innerText) && b.getAttribute('aria-expanded') !== null)`

try {
  await drive.capture('launch and open Wren', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise(r => setTimeout(r, 600))
      return 'opened'
    })()`)
  })

  // The premise, outside capture(): a control that is not on screen cannot
  // fail to dismiss, and every step below would pass by finding nothing.
  const present = await drive.evaluate(`JSON.stringify({ mode: ${MODE} !== undefined, route: ${ROUTE} !== undefined, effort: ${EFFORT} !== undefined })`)
  say(`  controls on screen: ${String(present)}`)
  if (!String(present).includes('"mode":true') || !String(present).includes('"route":true')) {
    throw new Error(`NOT A DISMISS TEST: the composer controls are not on screen -- ${String(present)}`)
  }

  await drive.capture('the permission mode menu', () => openThenClickAway('mode', MODE, '.lc-menu[role=menu]'))
  await drive.capture('and it still toggles from its own button', () => toggles('mode', MODE, '.lc-menu[role=menu]'))
  await drive.capture('the route picker', () => openThenClickAway('route', ROUTE, '.lc-picker'))
  await drive.capture('and it still toggles from its own button', () => toggles('route', ROUTE, '.lc-picker'))
  await drive.capture('the effort panel', () => openThenClickAway('effort', EFFORT, '.lc-effortpanel'))
  await drive.capture('nothing is left open', () => drive.evaluate(`'menus open: ' + document.querySelectorAll('.lc-menu[role=menu], .lc-picker, .lc-effortpanel').length`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate, nothing run. Each composer panel opened and then clicked away from.' })
}
