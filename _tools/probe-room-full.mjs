// Ticking more teammates than a room can hold.
//
//   node _tools/probe-room-full.mjs
//
// The member picker offers every teammate on the roster and has no limit of
// its own, so a roster bigger than MAX_ROOM_TEAMMATES lets a person tick a
// ninth. Create room then failed with "A room needs between 1 and 8
// teammates." -- offered and then refused, on the one screen where the
// number can still be changed.
//
// Nothing runs here. Eleven teammates are seeded, all are ticked, and the
// question is only what the form says and whether the button is offered.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const NAMES = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike', 'Ash', 'Bryn', 'Cove', 'Dell', 'Ember']
const HUES = ['lime', 'blue', 'clay', 'violet']

const workspace = await scratchRepository('locust-probe-room-full-ws-')
const drive = await startDrive({
  name: 'room-full',
  port: 9436,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: NAMES.map((name, i) => ({
      teammateId: `tm_${name.toLowerCase()}`,
      name,
      hue: HUES[i % HUES.length],
      role: 'Code & Migrations',
      createdAt: `2026-09-05T05:00:${String(i).padStart(2, '0')}.000Z`,
      route: { ...FREE_ROUTE, mode: 'ask' }
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Tick exactly `count` members and report what the form says about it. */
const tick = (count) => drive.evaluate(`(async () => {
  const boxes = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')]
  for (let i = 0; i < boxes.length; i += 1) {
    const want = i < ${String(count)}
    if (want !== (boxes[i].getAttribute('aria-checked') === 'true')) boxes[i].click()
  }
  await new Promise(r => setTimeout(r, 300))
  const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
  const note = [...document.querySelectorAll('.lc-settings__note')].map(n => n.innerText.trim()).find(t => /A room holds/.test(t)) ?? 'no note'
  return 'ticked ' + boxes.filter(b => b.getAttribute('aria-checked') === 'true').length +
    ' · Create room offered: ' + (create === undefined ? 'missing' : !create.disabled) +
    ' · says: ' + note
})()`)

try {
  await drive.capture('launch, and open Rooms with a roster of eleven', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    const input = document.querySelector('input[aria-label="Room name"]')
    if (!input) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Standup'); input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    return 'offered: ' + document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]').length
  })()`))

  // The premise, outside capture(): a roster smaller than the room limit
  // cannot reach this state at all, and the probe would report a missing
  // warning that is correctly missing.
  const offered = await drive.evaluate(`document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]').length`)
  if (Number(offered) < 9) throw new Error(`NOT A LIMIT TEST: the picker offered ${String(offered)} teammates, so nine can never be ticked`)

  await drive.capture('eight is fine', () => tick(8))
  await drive.capture('nine is not, and the button is not offered', () => tick(9))
  await drive.capture('eleven says how many to untick', () => tick(11))
  await drive.capture('back to eight and it is quiet again', () => tick(8))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Eleven teammates seeded, nothing run. Only the room form is exercised.' })
}
