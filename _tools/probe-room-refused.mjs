// A room member waiting will never help.
//
//   node _tools/probe-room-refused.mjs
//
// Since 0.56.1 the post is written BEFORE anyone is asked, with everyone
// queued, and each member leaves the queue as their run begins. That split
// the old single refusal path in two:
//
//   retryable   the cap is full, or that teammate is already working. They
//               stay queued and `room-tasks` starts them when a slot frees.
//               Driven by probe-room-absent.
//   permanent   gone from the roster, Antigravity, approve-each. Waiting
//               will never fix it, so `refuseQueued` moves them out of the
//               queue and records the host's words on the post.
//
// The second one has no live coverage, and it is the one that writes to the
// record. A teammate stuck in a queue nothing will ever drain is invisible
// in exactly the way the whole queue was built to prevent.
//
// A teammate set to "approve each action" is refused by a room post on
// purpose -- per-action approvals only exist on a transport a room does not
// use -- so it is a permanent refusal that costs nothing to produce.
//
// FREE: two short runs on the free OpenCode model; the third never starts.

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-refused-ws-')
const drive = await startDrive({
  name: 'room-refused',
  port: 9448,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-05T05:00:01.000Z', route: { ...FREE_ROUTE, mode: 'ask' } },
      // Refused by a room post, on purpose and for a reason waiting cannot fix.
      { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', createdAt: '2026-09-05T05:00:02.000Z', route: { ...FREE_ROUTE, mode: 'approve-each' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch and make a room of all three', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
      await new Promise(r => setTimeout(r, 800))
      const input = document.querySelector('input[aria-label="Room name"]')
      if (!input) return 'no name field'
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, 'Standup'); input.dispatchEvent(new Event('input', { bubbles: true }))
      for (const box of document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')) {
        if (box.getAttribute('aria-checked') !== 'true') box.click()
      }
      await new Promise(r => setTimeout(r, 300))
      const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
      if (!create || create.disabled) return 'Create room disabled'
      create.click()
      await new Promise(r => setTimeout(r, 1200))
      return document.querySelector('.lc-roomcompose__box') !== null ? 'MADE' : 'NOT MADE'
    })()`)
  })

  // The premise, outside capture(): no room, nothing to post to, and every
  // step below would report a missing line that is correctly missing.
  const made = await drive.evaluate(`document.querySelector('.lc-roomcompose__box') !== null`)
  if (made !== true) throw new Error('NOT A REFUSAL TEST: the room was never made')

  await drive.capture('post to all three', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Reply with exactly one word: READY. Nothing else.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      if (phases.length >= 2 && phases.every(p => /completed|failed|cancelled/i.test(p))) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return 'cards: ' + document.querySelectorAll('.lc-roomanswer').length +
      ' · waiting: ' + (document.querySelector('.lc-roomwaiting')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE') +
      ' · absent: ' + (document.querySelector('.lc-roomabsent')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE')
  })()`))

  await drive.capture('the refusal survives a reload of the room', () => drive.evaluate(`(async () => {
    /*
     * The reason is recorded ON THE POST, not held in the response. Leaving
     * the room and coming back is the cheapest way to prove that: a reason
     * that only lived in the response would be gone by now.
     */
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const row = [...document.querySelectorAll('.lc-roomrow, .lc-roomcard')].find(r => /Standup/.test(r.innerText))
    if (row) row.click()
    await new Promise(r => setTimeout(r, 900))
    return 'absent: ' + (document.querySelector('.lc-roomabsent')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE') +
      ' · waiting: ' + (document.querySelector('.lc-roomwaiting')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'NONE')
  })()`))

  await drive.capture('nobody is left stuck in a queue', () => drive.evaluate(`(async () => {
    // The failure this probe exists for: a permanently refused member left
    // in the queue would sit there forever, waiting for a slot that would
    // never help, and the room would never say everyone had answered.
    return 'waiting line present: ' + (document.querySelector('.lc-roomwaiting') !== null) +
      ' · note: ' + (document.querySelector('.lc-roomcompose__row .lc-settings__note')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none')
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates on the free OpenCode model; Gem is set to approve-each, which a room post refuses permanently.' })
}
