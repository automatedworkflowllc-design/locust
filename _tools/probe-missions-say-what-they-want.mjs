// Can you tell which of twelve missions to open, without opening them?
//
//   LOCUST_SPEND=1 node _tools/probe-missions-say-what-they-want.mjs
//
// The Missions screen was a table of title, owner, route, cost and a tag. A
// list where every row reads RUNNING tells you which one needs you only by
// opening each one.
//
// Grok Build's dashboard row says why in its own source (read 2026-09-11,
// `views/dashboard/row.rs`): the secondary line holds "the last tool call,
// the last assistant message, or (for `NeedsInput`) a 'Pending: …' preview of
// the front-most permission request", and `None` collapses the row to one
// line. This is that, on the screen Locust already had.
//
// What this measures: a RUNNING mission's row says what it is doing, in the
// same words its thread does; a mission waiting on a person says what it
// wants; and a settled mission stays one line.
//
// SPENDS one Claude Code turn on sonnet at low effort, in Approve-each so the
// run stops to ask and the waiting case is real rather than simulated.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-missionrow-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'missions-say-what-they-want',
  port: 9497,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_jim',
        name: 'Jimothy',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: now,
        route: { runtime: 'claude', model: 'sonnet', mode: 'approve-each', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

// No backticks inside these template literals.
const send = `(async () => {
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Jimothy/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 600))
  const box = document.querySelector('.lc-composer__box textarea')
  if (box === null) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, 'Create a file called notes.txt containing the word hello, then reply with the word done.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-composer__form').requestSubmit()
  return 'sent'
})()`

/** Send, then go straight to Missions without a round trip through the drive. */
const sendThenWatch = (send, watch) => `(async () => {
  const sent = await ${send}
  if (sent !== 'sent') return 'NOT THE TEST: ' + String(sent)
  return await ${watch}
})()`

/**
 * Watch the Missions screen while the run is live.
 *
 * Sampled rather than read once: the interesting states are transient, and a
 * single look would catch whichever happened to be on screen. Every distinct
 * line the row showed is kept, so the answer is what a person would have been
 * able to read at some point, not what it said at one instant.
 */
const watch = `(async () => {
  const open = [...document.querySelectorAll('button, a')].find(n => /^(Conversations|Missions)$/.test(n.innerText.trim()))
  if (open === undefined) return 'no Missions button'
  open.click()
  await new Promise(r => setTimeout(r, 150))
  const seen = new Set()
  let sawRow = false
  // Was there a row AT ALL while the teammate was visibly working? The first
  // two runs of this probe saw only COMPLETED, which has two very different
  // explanations -- the line is missing, or the ROW is -- and only this tells
  // them apart.
  let workingWithNoRow = 0
  let workingWithRow = 0
  for (let i = 0; i < 400; i += 1) {
    const working = [...document.querySelectorAll('.lc-row__metastate')]
      .some(n => /working|thinking|replying|using|waiting on you/i.test(n.innerText))
    const row = document.querySelector('.lc-missionrow')
    if (working) { if (row === null) workingWithNoRow += 1; else workingWithRow += 1 }
    if (row !== null) {
      sawRow = true
      const doing = row.querySelector('.lc-missionrow__doing')?.innerText.trim()
      const tag = row.querySelector('.lc-missionrow__tag')?.innerText.trim() ?? ''
      seen.add(tag + ' || ' + (doing ?? '(one line)'))
      if (/COMPLETED|FAILED|CANCELLED/.test(tag) && doing === undefined && !working) break
    }
    await new Promise(r => setTimeout(r, 250))
  }
  const lines = [...seen]
  return JSON.stringify({
    sawRow,
    workingWithNoRow,
    workingWithRow,
    lines,
    saidWhatItWasDoing: lines.some(l => l.startsWith('RUNNING') && !l.endsWith('(one line)')),
    saidWhatItWanted: lines.some(l => /Pending: /.test(l)),
    settledRowIsOneLine: lines.some(l => /COMPLETED|FAILED|CANCELLED/.test(l) && l.endsWith('(one line)'))
  }, null, 1)
})()`

try {
  await drive.capture('the row says what it is doing and what it wants', async () => {
    await drive.ready()
    return drive.evaluate(sendThenWatch(send, watch))
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet in Approve-each, asked to run a shell command. A live mission row must say what it is doing, a waiting one what it wants, and a settled one must stay a single line.'
  })
}
