// Does the room hold the argument it caused?
//
//   LOCUST_SPEND=1 node _tools/probe-room-holds-the-argument.mjs
//
// Colin, 2026-09-11, after posting "can you two argue? doing some testing" to
// a room: "shouldnt they be able to see eachothers messages? and have it
// contained to that room?" They argued four replies deep and the room showed
// one opening card each, so they read as talking past each other while the
// argument sat in two separate mission threads.
//
// The design agent's ruling: a grid is a CLAIM -- these arrived in parallel
// and none is a reply to another -- and it is false the instant message three
// answers message two. So a post that produced an exchange stops being a grid
// and becomes a sequence, first answers included.
//
// What this measures is that switch, on a real argument: the post must render
// as a sequence rather than as answer cards, with more turns than the room
// has members, and a foot line naming the budget.
//
// SPENDS a few turns on free routes -- Cursor's composer quota and OpenCode's
// free model. The hop cap is set to 3 so the argument ends quickly.

import { say, scratchRepository, startDrive, FREE_ROUTE } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a few free-route turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-roomarg-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'room-holds-the-argument',
  port: 9493,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      // Two different runtimes, as Colin's own argument had: the stronger one
      // is the likelier to use the share form rather than narrating both sides.
      // Accept edits, not Ask: Cursor Agent cannot be held read-only on Windows
      // -- its sandbox needs macOS or Linux -- so an Ask route refuses to start
      // and the argument has one participant. The first run of this probe lost
      // Wren that way and reported it as 'the room drew a grid'.
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: { runtime: 'cursor', model: 'composer-2.5', mode: 'accept-edits' } },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Docs & QA', createdAt: now, route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    // Relay ON is what lets one teammate answer another; the cap keeps the
    // argument short enough to watch.
    settings: { swarm: false, relay: true, relayHopCap: 3, memoryMode: 'off', autoMode: false }
  },
  files: {
    'rooms.json': {
      schemaVersion: 1,
      rooms: [{ roomId: 'rm_test', name: 'test', teammateIds: ['tm_wren', 'tm_gem'], createdAt: now, posts: [] }]
    }
  }
})

// No backticks inside these template literals.
const post = `(async () => {
  const rooms = [...document.querySelectorAll('button')].find(b => /New room/.test(b.innerText))
  const row = [...document.querySelectorAll('.lc-roomrow')].find(r => /test/.test(r.innerText))
  if (row === undefined) { rooms?.click(); await new Promise(r => setTimeout(r, 600)) }
  const again = [...document.querySelectorAll('.lc-roomrow')].find(r => /test/.test(r.innerText))
  if (again === undefined) return 'no room row'
  again.click()
  await new Promise(r => setTimeout(r, 700))
  const box = document.querySelector('.lc-roomcompose__box')
  if (box === null) return 'no room composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, 'Wren: you think tabs win. Gem: you think spaces win. SEND THE OTHER A MESSAGE making your case in two sentences, using the share form in your brief -- naming them in your answer does not reach them. Then reply to me with one sentence.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-roomcompose').requestSubmit()
  return 'posted'
})()`

/**
 * Wait for the whole argument to settle, then read the post's shape.
 *
 * The first version watched the answer cards' phase, which a RELAY run is not
 * -- a reply is a new mission of its own and draws no card. So it saw nothing
 * running, gave up, and screenshotted a room whose argument was still in
 * flight: the sidebar said "Wren - working" with a second conversation open.
 * Anything still going anywhere in the app counts.
 */
const shape = `(async () => {
  const busy = () => [...document.querySelectorAll('.lc-row__metastate')]
    .some(n => /working|thinking|replying|waiting on you/i.test(n.innerText))
  let quiet = 0
  for (let i = 0; i < 420; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    quiet = busy() ? 0 : quiet + 1
    // Eight quiet half-seconds: a relay hop takes a moment to be admitted, so
    // one idle sample is not the argument being over.
    if (quiet >= 8) break
  }
  await new Promise(r => setTimeout(r, 1500))
  const said = [...document.querySelectorAll('.lc-roomsaid__turn')]
  return JSON.stringify({
    sequenceTurns: said.length,
    answerCards: document.querySelectorAll('.lc-roomanswer').length,
    speakers: said.map(t => t.querySelector('.lc-roomsaid__name')?.innerText.trim() ?? '(continued)'),
    foot: document.querySelector('.lc-roomsaid__foot')?.innerText.trim() ?? 'no foot',
    absences: [...document.querySelectorAll('.lc-roomsaid__absent')].map(n => n.innerText.trim().slice(0, 70))
  }, null, 1)
})()`

try {
  await drive.capture('post an argument to a room of two', async () => {
    await drive.ready()
    const done = await drive.evaluate(post)
    if (done !== 'posted') return `NOT THE TEST: ${String(done)}`
    return String(done)
  })

  await drive.capture('the room draws the conversation, not a grid', async () => drive.evaluate(shape))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Two teammates on free routes in a room, relay on with a hop cap of 3, asked to argue. A post that produced replies must render as a sequence (.lc-roomsaid) rather than as answer cards, with a foot naming the budget.'
  })
}
