// What routes does this machine actually offer?
//
//   node _tools/drive-route-inventory.mjs
//
// Five smokes fail with "started, never done" on opencode, copilot, cursor
// and antigravity, while a Claude run settles in six seconds. Before calling
// that a product defect, ask the cheaper question: are those runtimes even
// installed here? A smoke that picks a route the machine cannot run is a
// broken instrument, not a broken app. This prints the route a new user
// starts on and every group/row the picker draws, with disabled rows marked.
//
// Deliberately regex-free: this file is edited through shells that eat
// backslashes, and a mangled \s cost two runs already.
//
// Spends nothing -- it opens the picker and reads it.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const flat = (text) => text.split(/\s+/).join(' ').trim()

const workspace = await scratchRepository('locust-drive-inventory-ws-')
const drive = await startDrive({
  name: 'route-inventory',
  port: 9326,
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
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// The picker's anatomy, copied from drive-lib's pickRouteScript: the opener is
// the .lc-control that owns the listbox, and each child of .lc-picker__list
// carries its group header and its row.
const INVENTORY = `(async () => {
  const flat = (text) => text.split(/\\s+/).join(' ').trim()
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  const starts = flat(control.innerText)
  if (control.disabled) return 'starts on: ' + starts + ' || the control is DISABLED'
  control.click()
  await new Promise((r) => setTimeout(r, 1500))
  const picker = document.querySelector('.lc-picker')
  if (!picker) return 'starts on: ' + starts + ' || the picker did not open'
  const list = picker.querySelector('.lc-picker__list')
  if (!list) return 'starts on: ' + starts + ' || the picker has no list'
  const rows = []
  let group = '?'
  for (const node of list.children) {
    const header = node.querySelector('.lc-picker__group')
    if (header) group = flat(header.innerText)
    const row = node.querySelector('.lc-picker__row')
    if (row) rows.push(group + ' :: ' + flat(row.innerText).slice(0, 54) + (row.disabled ? '  [DISABLED]' : ''))
  }
  const notice = picker.querySelector('.lc-picker__notice')
  return 'starts on: ' + starts
    + (notice ? ' || notice: ' + flat(notice.innerText) : '')
    + ' || ' + rows.length + ' rows >> ' + rows.join('  ;;  ')
})()`

try {
  await drive.capture('the route a new user starts on, and every route offered', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    return drive.evaluate(INVENTORY)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Which runtimes this machine can actually run, read off the picker itself.'
  })
}

void flat
