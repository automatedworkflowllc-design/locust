// Does ticking two names really make a room?
//
//   LOCUST_SPEND=1 node _tools/probe-ask-makes-a-room.mjs
//
// `probe-ask-who.mjs` reads what the box PROMISES. This is the other half:
// press it, and see whether a room exists afterwards with the post in it.
//
// Colin, 2026-09-09: "how does one create a room for teammates, i cant figure
// it out lol." The whole point of the change is that the answer is now "you
// already did" -- so the claim to check is that a person who has never opened
// the Rooms screen ends up with a room.
//
// SPENDS: two short Claude Code turns on sonnet at low effort, both asked for
// one word. Routes are PINNED in the seed rather than left to the composer's
// default, which would pick whatever the picker happens to offer.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two Claude Code turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-askroom-ws-')
const route = { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
const drive = await startDrive({
  name: 'ask-makes-a-room',
  port: 9463,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-05T05:01:00.000Z', route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('no rooms yet, and the person has never opened the screen', async () => {
    await drive.ready()
    return drive.evaluate(`(() => {
      const rail = document.querySelector('.lc-sidebar')?.innerText ?? ''
      return JSON.stringify({ roomsSection: /rooms/i.test(rail), named: /new room/i.test(rail) }, null, 1)
    })()`)
  })

  // The premise, OUTSIDE capture(): a picker that never rendered makes every
  // reading below a statement about an absent control.
  const chips = Number(await drive.evaluate(`document.querySelectorAll('.lc-askwho__pick').length`))
  if (chips < 2) throw new Error(`NO PICKER: the composer shows ${String(chips)} teammate chips`)

  await drive.capture('tick the second name and send', () => drive.evaluate(`(async () => {
    const atlas = [...document.querySelectorAll('.lc-askwho__pick')].find(c => /Atlas/.test(c.innerText))
    if (!atlas) return 'no Atlas chip'
    atlas.click()
    await new Promise(r => setTimeout(r, 400))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly one word: ready')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    for (let i = 0; i < 420; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const answers = document.querySelectorAll('.lc-roomanswer').length
      if (i > 10 && answers >= 2 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 2000))
    return (document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400))
  })()`))

  await drive.capture('what exists afterwards', () => drive.evaluate(`(() => {
    const title = document.querySelector('.lc-room__name')?.innerText.trim()
    const answers = [...document.querySelectorAll('.lc-roomanswer')].map(a => a.innerText.replace(/\\s+/g, ' ').trim().slice(0, 90))
    return JSON.stringify({
      onARoomScreen: document.querySelector('.lc-room') !== null,
      roomName: title ?? 'none',
      answers
    }, null, 1)
  })()`))

  await drive.capture('and the name can be changed, as the box promised', () => drive.evaluate(`(async () => {
    const title = document.querySelector('.lc-room__name')
    if (!title) return 'no renameable title'
    title.click()
    await new Promise(r => setTimeout(r, 400))
    const box = document.querySelector('.lc-room__rename')
    if (!box) return 'clicking the name did not open an input'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(box, 'Release crew')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    return 'room is now: ' + (document.querySelector('.lc-room__name')?.innerText.trim() ?? 'unreadable')
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Two teammates pinned to Claude Code / sonnet at low effort, each asked for one word. The Rooms screen is never opened by hand.' })
}
