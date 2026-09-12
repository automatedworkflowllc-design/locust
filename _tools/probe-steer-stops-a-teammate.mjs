// Does an urgent message actually stop the teammate it is for?
//
//   LOCUST_SPEND=1 node _tools/probe-steer-stops-a-teammate.mjs
//
// Steer shipped in 0.71.0 with unit tests and nothing else. Its whole job is to
// DISCARD WORK IN FLIGHT -- a teammate mid-run is stopped so a waiting message
// becomes their next one -- and a feature that destructive deserves one
// observation before it is trusted. Found by auditing what went out tonight
// against what was actually driven; every other feature had a probe.
//
// The shape, which is the only way to test this honestly:
//
//   1. Wren is given something long, so there is real work to interrupt.
//   2. Booty is asked to send Wren a share carrying when="now".
//   3. The host should stop Wren where she stands, and the reply she was sent
//      should then start as her next run.
//
// TWO THINGS THIS MUST NOT CONFUSE. A model that never writes when="now" has
// not tested Steer, so the notice is checked for the urgent wording and the
// probe says NOT THE TEST rather than reporting a pass. And a teammate who
// happened to finish on her own is not an interruption, so the first run must
// still be going when the urgent message lands.
//
// SPENDS: one OpenCode free turn (stopped early), one Cursor composer turn
// (free quota), and one more OpenCode turn for the reply.

import { say, scratchRepository, startDrive, FREE_ROUTE } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends free-route turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-steer-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'steer-stops-a-teammate',
  port: 9504,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Docs & QA', createdAt: now, route: { runtime: 'cursor', model: 'composer-2.5', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    // The switch this whole feature is behind. Off is the shipped default and
    // the reason nobody meets it by accident.
    settings: { swarm: false, relay: true, relayHopCap: 12, interrupt: true, memoryMode: 'off', autoMode: false }
  }
})

const SLOW = 'Write a detailed 800 word essay about the history of text editors. Take your time and be thorough.'
const URGENT = 'Send Wren a message using the share form in your brief, and put when="now" on it exactly like this: '
  + '<locust-share to="Wren" when="now">Stop what you are doing.</locust-share>. Send only that, and nothing else.'

// No backticks inside these template literals.
const start = `(async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const open = async (name) => {
    const row = [...document.querySelectorAll('.lc-row')].find(r => new RegExp(name).test(r.innerText))
    if (row === undefined) return false
    row.click()
    await new Promise(r => setTimeout(r, 700))
    return true
  }
  const send = async (text) => {
    const box = document.querySelector('.lc-composer__box textarea')
    if (box === null) return false
    setter.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-composer__form').requestSubmit()
    return true
  }
  if (!await open('Wren')) return 'no Wren'
  if (!await send(${JSON.stringify(SLOW)})) return 'no composer for Wren'
  // Let her actually get going: interrupting a run that has not started is
  // not the thing being tested.
  await new Promise(r => setTimeout(r, 6000))
  const wrenBusy = [...document.querySelectorAll('.lc-row__metastate')]
    .some(n => /working|thinking|using|writing/i.test(n.innerText))
  if (!await open('Booty')) return 'no Booty'
  if (!await send(${JSON.stringify(URGENT)})) return 'no composer for Booty'
  return JSON.stringify({ wrenBusy })
})()`

const watch = `(async () => {
  const seen = new Set()
  const busy = () => [...document.querySelectorAll('.lc-row__metastate')]
    .some(n => /working|thinking|using|starting|writing|replying/i.test(n.innerText))
  let quiet = 0
  for (let i = 0; i < 900; i += 1) {
    await new Promise(r => setTimeout(r, 400))
    for (const row of document.querySelectorAll('.lc-row')) seen.add(row.innerText.split(String.fromCharCode(10))[0])
    quiet = busy() ? 0 : quiet + 1
    if (quiet >= 14) break
  }
  await new Promise(r => setTimeout(r, 1500))
  // Every conversation, because the notice goes to the thread that SHARED --
  // Booty's -- and the stopped run is Wren's.
  let notices = ''
  let stoppedSomewhere = false
  // Conversation rows only. Clicking every row in the sidebar walked onto
  // the Routines screen and screenshotted that instead of the thread -- the
  // assertions were right, the picture was of somewhere else.
  const rows = [...document.querySelectorAll('.lc-row')].filter(
    (row) => row.closest('.lc-sidebar') !== null && !/^Save one from/.test(row.innerText)
  )
  for (const row of rows) {
    row.click()
    await new Promise(r => setTimeout(r, 500))
    notices += document.body.innerText
    if (/stopped|cancelled/i.test(document.body.innerText)) stoppedSomewhere = true
  }
  return JSON.stringify({
    conversations: rows.length,
    // Did the SENDER'S thread say the recipient was stopped part-way? This is
    // the sentence the feature exists to produce.
    saidStoppedPartWay: /stopped part-way so they can take this next/i.test(notices),
    // The two ways this can be NOT THE TEST rather than a failure.
    switchedOffInstead: /switched off in Settings/i.test(notices),
    neverAskedUrgently: /part-way through another mission/i.test(notices) && !/stopped part-way/i.test(notices),
    stoppedSomewhere,
    tail: notices.slice(-400)
  }, null, 1)
})()`

try {
  await drive.capture('Wren starts something long, then Booty sends an urgent message', async () => {
    await drive.ready()
    return drive.evaluate(start)
  })

  await drive.capture('the host stops Wren so the message is her next one', () => drive.evaluate(watch))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on the free route is given a long essay; Booty on Cursor is asked to send her a share carrying when="now". With the interrupt switch ON, the host must stop Wren part-way and say so in the thread that shared.'
  })
}
