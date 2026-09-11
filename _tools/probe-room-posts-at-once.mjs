// Is a room post on screen before the runtimes are?
//
//   LOCUST_SPEND=1 node _tools/probe-room-posts-at-once.mjs
//
// Colin, 2026-09-11, with a screenshot of his own words still sitting in the
// composer under "Posting...", the room above them reading "Nothing posted
// yet": "minor bug, chat stays there, loading in chat, instead of posting to
// conversation immediately."
//
// Asking a room is one runtime start per member and each can be a cold boot,
// so the post's own response is seconds away. The post is on disk before the
// first member is asked -- that has been true since the queue landed -- but
// nothing SAID so, and the window learned about it either from the first
// `mission-started` or from that late response.
//
// What this measures is the half-second after pressing Post: the box must be
// empty and the post must be drawn, while every teammate is still idle. That
// last clause is the point -- measuring after a run starts would pass on the
// old build too.
//
// It also captures the room's chrome bar, which Colin called brutal in the
// same session, at two widths.
//
// SPENDS two free-route turns.

import { say, scratchRepository, startDrive, FREE_ROUTE } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two free-route turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-roompost-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'room-posts-at-once',
  port: 9494,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Docs & QA', createdAt: now, route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 3, memoryMode: 'off', autoMode: false }
  },
  files: {
    'rooms.json': {
      schemaVersion: 1,
      rooms: [{ roomId: 'rm_test', name: 'a room with a name long enough to test the bar', teammateIds: ['tm_wren', 'tm_gem'], createdAt: now, posts: [] }]
    }
  }
})

// No backticks inside these template literals.
const openRoom = `(async () => {
  const row = [...document.querySelectorAll('.lc-roomrow')].find(r => /a room with a name/.test(r.innerText))
  if (row === undefined) return 'no room row'
  row.click()
  await new Promise(r => setTimeout(r, 700))
  return document.querySelector('.lc-roomcompose__box') === null ? 'no composer' : 'open'
})()`

/**
 * Post, then read the screen 400ms later.
 *
 * Deliberately impatient. A cold runtime takes seconds, so anything true at
 * 400ms is true because the host said the post landed, not because a run
 * started -- and `idleThen` is what proves that: if a teammate is already
 * working, this measurement proves nothing and says so.
 */
const postAndLookImmediately = `(async () => {
  const box = document.querySelector('.lc-roomcompose__box')
  if (box === null) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, 'Say OK and nothing else.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 150))
  document.querySelector('.lc-roomcompose').requestSubmit()
  await new Promise(r => setTimeout(r, 400))
  const working = [...document.querySelectorAll('.lc-row__metastate')]
    .filter(n => /working|thinking|replying/i.test(n.innerText)).length
  return JSON.stringify({
    boxHolds: document.querySelector('.lc-roomcompose__box').value,
    postsDrawn: document.querySelectorAll('.lc-roompost').length,
    saysNothingPosted: /Nothing posted yet/.test(document.body.innerText),
    idleThen: working === 0
  }, null, 1)
})()`

/** The chrome bar: three things, and whether they still fit side by side. */
const bar = `(() => {
  const box = (selector) => {
    const node = document.querySelector(selector)
    if (node === null) return null
    const r = node.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }
  }
  const back = box('.lc-room__back')
  const heading = box('.lc-room__heading')
  const remove = box('.lc-room__remove')
  return JSON.stringify({
    back,
    heading,
    remove,
    name: document.querySelector('.lc-room__name')?.innerText.trim() ?? 'none',
    members: document.querySelector('.lc-room__members')?.innerText.trim() ?? 'none',
    // The name over the members, not beside them.
    membersBelowName: (box('.lc-room__members')?.top ?? 0) >= (box('.lc-room__name')?.bottom ?? 0) - 2,
    gapAfterBack: back === null || heading === null ? null : heading.left - back.right,
    overlaps: back !== null && heading !== null && remove !== null
      && (heading.left < back.right || remove.left < heading.right)
  }, null, 1)
})()`

try {
  await drive.capture('open a room', async () => {
    await drive.ready()
    return drive.evaluate(openRoom)
  })

  await drive.capture('the chrome bar at 1280', () => drive.evaluate(bar))

  await drive.capture('the chrome bar at 900', async () => {
    await drive.resize(900, 760)
    await new Promise((r) => setTimeout(r, 400))
    return drive.evaluate(bar)
  })

  await drive.capture('the post is on screen before any runtime is', async () => {
    await drive.resize(1280, 860)
    await new Promise((r) => setTimeout(r, 400))
    return drive.evaluate(postAndLookImmediately)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Two teammates on the free route in a room. Pressing Post must empty the box and draw the post within 400ms, while every teammate is still idle; and the room chrome bar must hold its three parts apart at 1280 and 900.'
  })
}
