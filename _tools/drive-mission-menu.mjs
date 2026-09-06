// Right-click a conversation: does Assign and does Delete actually work?
//
//   node _tools/drive-mission-menu.mjs
//
// Colin, 2026-09-06: "the right click, assign to teammate isnt work, along
// with the right click delete conversation." Both are real menu items with
// real handlers, so before changing either, find out WHICH of two things is
// true:
//
//   1. they are broken, or
//   2. they were DISABLED because a run was live -- both carry a
//      `disabledReason` in exactly that case -- and a greyed item whose
//      reason only appears in a hover tooltip is indistinguishable from a
//      broken one.
//
// His screenshot said "1 running" in the title bar while he was trying, which
// makes (2) the likelier of the two and is precisely why it has to be
// measured rather than assumed.
//
// Runs no model: it seeds a finished mission into the ledger and drives the
// menu, so it costs nothing and cannot be flaky on a runtime.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-menu-ws-')

const drive = await startDrive({
  name: 'mission-menu',
  port: 9318,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', createdAt: '2026-09-05T05:00:01.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Right-click the first row in the Missions section and read the menu out. */
const openMenu = `(async () => {
  const rows = [...document.querySelectorAll('.lc-teammate__mission, .lc-row:not(.lc-row--button)')]
  const row = rows[0]
  if (row === undefined) return 'NO MISSION ROW TO RIGHT-CLICK'
  const box = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10)
  }))
  await new Promise(r => setTimeout(r, 500))
  const items = [...document.querySelectorAll('.lc-context__item')]
  if (items.length === 0) return 'MENU DID NOT OPEN'
  return items.map(b => b.innerText.trim() + (b.disabled ? ' [DISABLED: ' + (b.title || 'no reason given') + ']' : '')).join(' | ')
})()`

try {
  await drive.ready()

  await drive.capture('a finished conversation, and a right-click on it', async () => {
    // One short run so there is a real conversation to right-click. The free
    // model, so this costs nothing.
    await drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren')?.click()
      await new Promise(r => setTimeout(r, 500))
    })()`)
    const { pickRouteScript, sendAndWaitScript } = await import('./drive-lib.mjs')
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
    await drive.evaluate(sendAndWaitScript('Reply with exactly the word READY and nothing else.', { waitSeconds: 300 }))
    return drive.evaluate(openMenu)
  })

  await drive.capture('press Assign to Gem, and see whether the owner moves', () => drive.evaluate(`(async () => {
    const before = [...document.querySelectorAll('.lc-teammate')].map(r => r.innerText.split(String.fromCharCode(10))[0]).join(',')
    const assign = [...document.querySelectorAll('.lc-context__item')].find(b => /^Assign to Gem/.test(b.innerText.trim()))
    if (assign === undefined) return 'NO ASSIGN ITEM IN THE MENU'
    if (assign.disabled) return 'ASSIGN IS DISABLED: ' + (assign.title || 'no reason given')
    assign.click()
    await new Promise(r => setTimeout(r, 1200))
    const gemRow = [...document.querySelectorAll('.lc-teammate')].find(r => /^Gem/.test(r.innerText.trim()))
    const gemHasIt = /READY|Reply with exactly/i.test(gemRow?.innerText ?? '')
    return 'clicked. teammates before: ' + before + ' || Gem now shows the conversation: ' + gemHasIt
  })()`))

  await drive.capture('right-click again and press Delete, twice for the confirm', () => drive.evaluate(`(async () => {
    const rows = [...document.querySelectorAll('.lc-teammate__mission, .lc-row:not(.lc-row--button)')]
    const row = rows[0]
    if (row === undefined) return 'no row left to delete'
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
    await new Promise(r => setTimeout(r, 500))
    const del = [...document.querySelectorAll('.lc-context__item')].find(b => /^Delete/.test(b.innerText.trim()))
    if (del === undefined) return 'NO DELETE ITEM IN THE MENU'
    if (del.disabled) return 'DELETE IS DISABLED: ' + (del.title || 'no reason given')
    const rowsBefore = document.querySelectorAll('.lc-teammate__mission, .lc-row:not(.lc-row--button)').length
    del.click()
    await new Promise(r => setTimeout(r, 400))
    // It arms first and asks; the second press is the confirmation.
    const armed = [...document.querySelectorAll('.lc-context__item')].find(b => /Delete for good/.test(b.innerText))
    if (armed === undefined) return 'first press did not arm the confirm'
    armed.click()
    await new Promise(r => setTimeout(r, 1200))
    const rowsAfter = document.querySelectorAll('.lc-teammate__mission, .lc-row:not(.lc-row--button)').length
    return 'rows ' + rowsBefore + ' -> ' + rowsAfter + (rowsAfter < rowsBefore ? ' (deleted)' : ' (NOTHING WAS DELETED)')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One short run on the free OpenCode model, then the conversation right-clicked and Assign and Delete pressed for real.'
  })
}
