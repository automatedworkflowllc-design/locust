// Opening the picker the way a person opens it: cold, with no search.
//
//   node _tools/drive-effort-cold-open.mjs
//
// drive-effort-reachable said effort was reachable. It searched for the
// model first, which is NOT what a person does and which forces the
// canonical row into the visible list. Colin, on the shipped build, still
// has no effort control.
//
// Two things in the picker could hide the chips on a cold open:
//
//   1. `capRouteRows` limits each runtime group, so the active model can be
//      capped out of its own group and never drawn.
//   2. recently-used routes are duplicated into a "Recent" group at the top,
//      and the chips are suppressed there -- `isActive && !recent && ...` --
//      on the assumption the canonical row below still draws them. If that
//      row is capped away, NOTHING draws them.
//
// So this uses a route, closes the picker, and reopens it cold.
//
// Spends nothing.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-cold-open-ws-')
const drive = await startDrive({
  name: 'effort-cold-open',
  port: 9335,
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

const CLOSE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (control && document.querySelector('.lc-picker')) control.click()
  await new Promise((r) => setTimeout(r, 600))
  return document.querySelector('.lc-picker') ? 'still open' : 'closed'
})()`

// Cold: click the chip and read what is drawn, typing nothing.
const COLD = `(async () => {
  const flat = (el) => el.innerText.split(/\\s+/).join(' ').trim()
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  const chip = flat(control)
  control.click()
  await new Promise((r) => setTimeout(r, 1500))
  const picker = document.querySelector('.lc-picker')
  if (!picker) return 'chip: ' + chip + ' || picker did not open'
  const list = picker.querySelector('.lc-picker__list')
  const actives = []
  let group = '?'
  for (const node of (list ? list.children : [])) {
    const header = node.querySelector('.lc-picker__group')
    if (header) group = flat(header.innerText ? header : header)
    const row = node.querySelector('.lc-picker__row')
    if (!row) continue
    const tag = row.querySelector('.lc-picker__tag')
    if (tag && /ACTIVE/.test(tag.innerText)) {
      actives.push(group + ' >> ' + flat(row).slice(0, 30))
    }
  }
  const chips = picker.querySelectorAll('.lc-picker__effort')
  const more = [...picker.querySelectorAll('.lc-picker__more')].map(flat)
  return [
    'chip: ' + chip.slice(0, 44),
    'ACTIVE rows: ' + actives.length + (actives.length ? ' [' + actives.join(' ;; ') + ']' : ''),
    'effort chips: ' + chips.length + (chips.length ? ' >> ' + [...chips].map(flat).join(' ') : ''),
    'cap lines: ' + (more.length ? more.join(' ;; ') : 'none')
  ].join('  ||  ')
})()`

try {
  await drive.capture('cold open on the route a fresh profile starts on', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Message Wren')
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(COLD)
  })

  await drive.capture('pick Claude Code / Sonnet (by searching, as before)', async () => {
    await drive.evaluate(CLOSE)
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
  })

  await drive.capture('NOW reopen it cold — this is the path a person takes', async () => {
    await drive.evaluate(CLOSE)
    return drive.evaluate(COLD)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'The picker opened cold, with nothing typed — the way effort is actually reached.'
  })
}
