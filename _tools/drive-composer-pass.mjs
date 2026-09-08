// The composer after the design pass: four controls, not seven.
//
//   node _tools/drive-composer-pass.mjs
//
// The review counted seven controls and said three were not earning their
// place: a permanently-disabled `+`, an effort chip reading "effort · fixed"
// on most routes, and a swarm toggle that DISABLED that chip to hold it at
// the model maximum. Effort and swarm moved into the route picker; the plus
// waits for attachments.
//
// This reads what is actually on screen, then opens the picker and reads that.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-composer-ws-')

const drive = await startDrive({
  name: 'composer-pass',
  port: 9319,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('the controls row, counted', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 700)) })()`)
    return drive.evaluate(`(() => {
      const row = document.querySelector('.lc-composer__controls')
      const controls = [...(row?.querySelectorAll('button') ?? [])]
      return 'controls: ' + controls.length
        + ' || ' + controls.map(b => (b.innerText.replace(/[ ]+/g, ' ').trim() || b.getAttribute('aria-label') || 'icon') + (b.disabled ? ' [DISABLED]' : '')).join(' | ')
        + ' || any dead plus: ' + /not built yet/.test(row?.innerHTML ?? '')
    })()`)
  })

  await drive.capture('open the picker: effort and swarm live here now', async () => {
    await drive.evaluate(pickRouteScript({ group: '/claude/i', search: '', row: '/^sonnet/i' }))
    await drive.evaluate(`(async () => {
      const chip = [...document.querySelectorAll('.lc-control')].find(b => /Claude|OpenCode|Codex/.test(b.innerText))
      chip?.click()
      await new Promise(r => setTimeout(r, 700))
    })()`)
    return drive.evaluate(`(() => {
      const picker = document.querySelector('.lc-picker')
      if (picker === null) return 'picker did not open'
      const swarm = picker.querySelector('.lc-picker__swarm')
      const efforts = [...picker.querySelectorAll('.lc-picker__effort')].map(b => b.innerText.trim())
      const actives = [...picker.querySelectorAll('.lc-picker__row.is-active')].map(r => ({
        name: r.innerText.replace(/[ ]+/g, ' ').split(String.fromCharCode(10))[0],
        recent: r.closest('.lc-picker__tray') !== null,
        detail: (r.querySelector('.lc-picker__detail') || {}).innerText || 'no detail'
      }))
      const active = picker.querySelector('.lc-picker__row.is-active')
      const groups = picker.querySelectorAll('.lc-picker__efforts').length
      return 'actives: ' + JSON.stringify(actives) + ' || active row: ' + (active === null ? 'NONE MARKED ACTIVE' : active.innerText.replace(/[ ]+/g, ' ').split(String.fromCharCode(10))[0])
        + ' || effort groups in the DOM: ' + groups
        + ' || swarm row: ' + (swarm === null ? 'ABSENT' : swarm.innerText.replace(/[ ]+/g, ' ').split(String.fromCharCode(10)).join(' '))
        + ' || effort levels on the chosen row: ' + (efforts.length === 0 ? 'none drawn' : efforts.join(', '))
    })()`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. The composer after the design review moved effort and swarm into the route picker and removed the disabled plus.' })
}
