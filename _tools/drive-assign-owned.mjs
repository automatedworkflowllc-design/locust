// Assign a conversation that ALREADY belongs to a teammate.
//
//   node _tools/drive-assign-owned.mjs
//
// Colin, 2026-09-08: "it was a random conversation, and i right clicked it and
// hit assign to wren, nothing happened."
//
// `drive-mission-menu.mjs` already covers assign and passes -- but it assigns a
// conversation that belongs to NOBODY, straight after one short run. That is
// not the case he hit. A conversation a person right-clicks in anger is one
// that already has an owner and more than one turn, and those two facts each
// touch a different piece of code:
//
//   - The sidebar groups by `mission.ownerId ?? missionOwners[missionId]`, so a
//     row that carries an ownerId ignores the assignment entirely.
//   - `collapseConversations` returns `{...leaf}`, so a multi-turn conversation
//     is keyed by its NEWEST turn while its earlier turns keep their own ids.
//
// Free model throughout: this is about which teammate a row sits under, and
// that costs nothing to look at.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-assign-ws-')
let handoff
let drive = await startDrive({
  name: 'assign-owned',
  port: 9366,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-05T05:01:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** How many conversation rows sit under each teammate right now. */
const rowsUnder = `(() => {
  const out = {}
  for (const card of document.querySelectorAll('.lc-teammate')) {
    const name = (card.querySelector('.lc-row__name')?.innerText ?? '?').trim()
    out[name] = card.querySelectorAll('.lc-teammate__mission').length
  }
  return JSON.stringify(out)
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('Wren runs a TWO-turn conversation on the free model', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
    await drive.evaluate(sendAndWaitScript('Reply with exactly one word: one.', { waitSeconds: 240 }))
    // The second turn is what makes this a CONVERSATION rather than a mission,
    // and what makes the sidebar row keyed by a different id than the first.
    await drive.evaluate(sendAndWaitScript('Reply with exactly one word: two.', { waitSeconds: 240 }))
    return drive.evaluate(rowsUnder)
  })

  await drive.capture('right-click that conversation under Wren', () => drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-teammate__mission')
    if (!row) return 'no conversation under any teammate'
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10)
    }))
    await new Promise(r => setTimeout(r, 600))
    const items = [...document.querySelectorAll('.lc-context__item')]
    if (items.length === 0) return 'MENU DID NOT OPEN'
    return items.map(b => b.innerText.trim() + (b.disabled ? ' [DISABLED]' : '')).join(' | ')
  })()`))

  await drive.capture('press Assign to Gem, and see whether it actually moves', () => drive.evaluate(`(async () => {
    const before = document.querySelectorAll('.lc-teammate')[0]?.querySelectorAll('.lc-teammate__mission').length ?? -1
    const assign = [...document.querySelectorAll('.lc-context__item')].find(b => /^Assign to Gem/.test(b.innerText.trim()))
    if (assign === undefined) return 'NO ASSIGN-TO-GEM ITEM'
    if (assign.disabled) return 'ASSIGN IS DISABLED: ' + (assign.title || 'no reason given')
    assign.click()
    await new Promise(r => setTimeout(r, 2000))
    const cards = [...document.querySelectorAll('.lc-teammate')]
    const counts = cards.map(c => (c.querySelector('.lc-row__name')?.innerText ?? '?').trim() + '=' + c.querySelectorAll('.lc-teammate__mission').length)
    const notice = document.querySelector('.lc-sidebar__error, .lc-notice, .lc-toast')
    return 'Wren had ' + before + ' || after: ' + counts.join(', ')
      + (notice ? ' || notice on screen: ' + notice.innerText.trim().slice(0, 120) : ' || no notice anywhere')
  })()`))

  // THE decisive difference from every other assign drive: after a restart the
  // conversation is no longer a live run in memory, it is a row read back from
  // the ledger. That is what Colin is right-clicking -- a conversation from
  // earlier, not one he just watched finish -- and the two take different
  // paths through the sidebar's grouping.
  handoff = await drive.finish({
    intro: 'A TWO-turn conversation belonging to Wren, reassigned to Gem while live, then the app closed and opened again so the same conversation comes back from the ledger.',
    last: false
  })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  drive = await startDrive({
    name: 'assign-owned',
    port: 9366,
    workspace,
    profilePath: handoff.profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  await drive.capture('opened again: the conversation now comes from the ledger', async () => {
    await drive.ready()
    return drive.evaluate(rowsUnder)
  })

  await drive.capture('right-click it and assign it BACK to Wren', () => drive.evaluate(`(async () => {
    const row = document.querySelector('.lc-teammate__mission') ?? document.querySelector('.lc-row--mission')
    if (!row) return 'no conversation row anywhere after the restart'
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(box.left + 20), clientY: Math.round(box.top + 10) }))
    await new Promise(r => setTimeout(r, 700))
    const assign = [...document.querySelectorAll('.lc-context__item')].find(b => /^Assign to Wren/.test(b.innerText.trim()))
    if (assign === undefined) {
      return 'NO ASSIGN-TO-WREN ITEM. menu was: ' + [...document.querySelectorAll('.lc-context__item')].map(b => b.innerText.trim()).join(' | ')
    }
    if (assign.disabled) return 'ASSIGN IS DISABLED: ' + (assign.title || 'no reason given')
    assign.click()
    await new Promise(r => setTimeout(r, 2000))
    const counts = [...document.querySelectorAll('.lc-teammate')]
      .map(c => (c.querySelector('.lc-row__name')?.innerText ?? '?').trim() + '=' + c.querySelectorAll('.lc-teammate__mission').length)
    return 'after pressing Assign to Wren: ' + counts.join(', ')
  })()`))
} catch (error) {
  say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Continued: the same conversation, now read back from the ledger rather than held as a live run.' })
}
