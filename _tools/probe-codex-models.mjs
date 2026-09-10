// What does Codex actually offer in the picker?
//
//   node _tools/probe-codex-models.mjs
//
// Colin, 2026-09-09, after I ran a drive on `gpt-6-astra`: "astra is very
// expensive brother, they have a ton of other models to use" and "why can we
// only run astra?"
//
// Every Codex drive in this repository pins `gpt-6-astra`, and
// drive-approval.mjs carries a comment claiming Codex's `model/list` reports
// exactly one model. If that is stale then the drives have all been running
// on the most expensive thing on the menu for no reason. If it is TRUE then
// the picker is hiding models the account has, which is the defect Colin is
// pointing at.
//
// Sends nothing to any model: it opens the picker and reads it.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-codexmodels-ws-')
const drive = await startDrive({
  name: 'codex-models',
  port: 9454,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const openPicker = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return 'no route control'
  if (!document.querySelector('.lc-picker')) control.click()
  await new Promise(r => setTimeout(r, 700))
  return document.querySelector('.lc-picker') === null ? 'picker did not open' : 'open'
})()`

/** Every row under the Codex group, whatever the catalog says today. */
const codexRows = `(async () => {
  const list = document.querySelector('.lc-picker__list')
  if (!list) return 'no list'
  let group = ''
  const rows = []
  for (const node of list.children) {
    const header = node.querySelector('.lc-picker__group')
    if (header) group = header.innerText.trim()
    const row = node.querySelector('.lc-picker__row')
    if (row && /codex/i.test(group)) {
      rows.push(row.innerText.replace(/\\s+/g, ' ').trim().slice(0, 70) + (row.disabled ? ' [DISABLED]' : ''))
    }
  }
  return JSON.stringify({ group, count: rows.length, rows }, null, 1)
})()`

const search = (term) => `(async () => {
  const box = document.querySelector('.lc-picker__input')
  if (!box) return 'no search box'
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(box, ${JSON.stringify(term)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 600))
  const rows = [...document.querySelectorAll('.lc-picker__row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim().slice(0, 70))
  const empty = document.querySelector('.lc-picker__empty')?.innerText.trim()
  return JSON.stringify({ term: ${JSON.stringify(term)}, matched: rows.length, rows, empty }, null, 1)
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('open the route picker', () => drive.evaluate(openPicker))

  // The premise, outside capture(): a catalog that has not arrived yet lists
  // nothing, and every reading below would report an empty menu as a fact
  // about the account rather than about the moment.
  await drive.evaluate(`new Promise(r => setTimeout(r, 15000))`)
  const total = Number(await drive.evaluate(`document.querySelectorAll('.lc-picker__row').length`))
  if (total < 2) throw new Error(`NOT A CATALOG TEST: the picker lists ${String(total)} row(s), so nothing has loaded yet`)
  say(`  ${String(total)} rows in the picker`)

  await drive.capture('every Codex row', () => drive.evaluate(codexRows))
  await drive.capture('searching for luna', () => drive.evaluate(search('luna')))
  await drive.capture('searching for gpt', () => drive.evaluate(search('gpt')))
  await drive.capture('every group the picker has', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-picker__input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(box, ''); box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 600))
    const groups = [...document.querySelectorAll('.lc-picker__group')].map(g => g.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify({ groups, rowsTotal: document.querySelectorAll('.lc-picker__row').length }, null, 1)
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate, nothing run. Only the route picker is read.' })
}
