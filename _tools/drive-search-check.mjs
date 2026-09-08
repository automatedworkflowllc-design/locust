// Can the picker's search actually find a model deep in a long list?
//
//   node _tools/drive-search-check.mjs
//
// The diff smoke types "composer 2.5" under Cursor Agent and gets back an
// EMPTY picker -- {"picked":false,"why":"no composer row after search",
// "rows":[]} -- although the route inventory (2026-09-07) shows the row is
// really there, reading "Composer 2.5 (current)", and routeSearchText folds
// both the needle and the label to "composer 2 5" so they ought to match.
//
// Cursor lists 6 models and then "65 more models · type to search them", so
// this is the search that makes the other 65 reachable at all. If it is
// broken, most of a runtime's models cannot be picked by a person either.
//
// Spends nothing -- it opens the picker and types.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-search-ws-')
const drive = await startDrive({
  name: 'search-check',
  port: 9330,
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

// What the picker holds for a needle, without picking anything: how many rows
// survive the filter, what the cap line says, and the first few labels.
const searchReport = (needle) => `(async () => {
  const flat = (text) => text.split(/\\s+/).join(' ').trim()
  const picker = document.querySelector('.lc-picker')
  if (!picker) return 'the picker is not open'
  const box = picker.querySelector('.lc-picker__input')
  if (!box) return 'no search box'
  const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setInput.call(box, ${JSON.stringify(needle)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  const rows = []
  let group = '?'
  const list = picker.querySelector('.lc-picker__list')
  for (const node of (list ? list.children : [])) {
    const header = node.querySelector('.lc-picker__group')
    if (header) group = flat(header.innerText)
    const row = node.querySelector('.lc-picker__row')
    if (row) rows.push(group + ' :: ' + flat(row.innerText).slice(0, 46))
  }
  const more = picker.querySelector('.lc-picker__more')
  const empty = picker.querySelector('.lc-inspector__empty')
  return 'needle ' + JSON.stringify(${JSON.stringify(needle)})
    + ' || ' + rows.length + ' rows'
    + (more ? ' || more line: ' + flat(more.innerText) : '')
    + (empty ? ' || empty says: ' + flat(empty.innerText) : '')
    + (rows.length ? ' >> ' + rows.slice(0, 6).join('  ;;  ') : '')
})()`

const OPEN_PICKER = `(async () => {
  const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
  if (open) open.click()
  await new Promise((r) => setTimeout(r, 900))
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  control.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('.lc-picker') ? 'picker open' : 'picker did not open'
})()`

try {
  await drive.capture('open the picker', async () => {
    await drive.ready()
    return drive.evaluate(OPEN_PICKER)
  })

  // The exact needle the diff smoke types, then the variants that tell us
  // whether it is the dot, the space, or the cap line that loses the row.
  for (const needle of ['account default']) {
    await drive.capture(`search: ${needle}`, () => drive.evaluate(searchReport(needle)))
  }

  await drive.capture('and Cursor’s can actually be picked', () =>
    drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'account default', row: '/account default/i' }))
  )
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The picker search, typed the way the diff smoke types it, against a model 65 rows deep.'
  })
}
