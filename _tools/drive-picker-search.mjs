// Does the picker still find Cursor's Composer 2.5?
//
//   node _tools/drive-picker-search.mjs
//
// The diff smoke failed with `no composer row after search, rows: []` -- an
// EMPTY picker, not a missing row. The catalogue is now re-read when the
// picker opens (0.37.0, so a runtime that finishes probing late is not
// missing for the session), and a re-read that comes back thinner than what
// it replaces would empty the list at exactly the moment a person is looking
// at it. This checks the rows before and after that refresh lands.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-picker-ws-')
const drive = await startDrive({
  name: 'picker-search',
  port: 9323,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const rowsNow = `(() => {
  const picker = document.querySelector('.lc-picker')
  if (picker === null) return 'picker closed'
  const rows = [...picker.querySelectorAll('.lc-picker__row')]
  return rows.length + ' rows :: ' + rows.map(r => r.innerText.split(String.fromCharCode(10))[0]).slice(0, 6).join(', ')
})()`

try {
  await drive.capture('open the picker and wait for it to settle', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 800))
      const chip = [...document.querySelectorAll('.lc-control')].find(b => /Codex|OpenCode|Claude/.test(b.innerText))
      chip?.click()
      await new Promise(r => setTimeout(r, 2500))
    })()`)
    return drive.evaluate(rowsNow)
  })

  await drive.capture('search for composer 2.5, the way the smoke does', () => drive.evaluate(`(async () => {
    const picker = document.querySelector('.lc-picker')
    const input = picker?.querySelector('.lc-picker__input')
    if (!input) return 'no search field'
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(input, 'composer 2.5')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    const rows = [...picker.querySelectorAll('.lc-picker__row')]
    return rows.length + ' rows :: ' + rows.map(r => r.innerText.split(String.fromCharCode(10))[0]).slice(0, 6).join(', ')
  })()`))

  await drive.capture('and once more after everything has settled', () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 4000))
    const picker = document.querySelector('.lc-picker')
    const rows = [...(picker?.querySelectorAll('.lc-picker__row') ?? [])]
    return rows.length + ' rows :: ' + rows.map(r => r.innerText.split(String.fromCharCode(10))[0]).slice(0, 6).join(', ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. The picker searched the way the diff smoke searches it.' })
}
