// How far does the thread jump while a reply streams?
//
//   LOCUST_SPEND=1 node _tools/probe-reply-arrives-smoothly.mjs
//
// Colin, 2026-09-11: "the way the text comes down from the clients is very
// glitchy is there a way to make it smoother the way claude code transitions
// down with the chat, our app just seems very jumpy/twitchy."
//
// NOT the same complaint as 2026-09-10. That one was cadence -- every delta
// its own render -- and reflow -- a delta closing a `*` reclassifying text
// already read. Both were fixed (`streamFrames.ts`, `settledText.ts`) and
// both were measured. What is left has to be measured before it is changed,
// because twice this week a plausible cause was wrong.
//
// What this measures: every animation frame while a reply arrives, the
// thread's own scrollTop and scrollHeight. A stream that reads as smooth
// moves a line or two per frame; a stream that reads as twitchy moves in
// bursts with nothing in between. The numbers that matter are the biggest
// single jump and how much of the total travel the worst few frames carry --
// one 400px lurch is what a person calls glitchy, however good the average.
//
// SPENDS one Claude Code turn on sonnet at low effort. The prompt asks for a
// long answer with headings, a list and a fenced block on purpose: those are
// the three shapes whose height changes when a block closes.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-smooth-ws-')
const now = '2026-09-05T05:00:00.000Z'

const drive = await startDrive({
  name: 'reply-arrives-smoothly',
  port: 9498,
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
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})

// No backticks inside these template literals.
const ASK = 'Write about 400 words on why indentation style arguments persist. '
  + 'Use two headings, a bulleted list of at least four items, one short fenced code block, '
  + 'and some bold text. Do not read or write any files.'

const send = `(async () => {
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Jimothy/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 600))
  const box = document.querySelector('.lc-composer__box textarea')
  if (box === null) return 'no composer'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(ASK)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-composer__form').requestSubmit()
  return 'sent'
})()`

/**
 * Sample every animation frame, not on a timer.
 *
 * A timer samples the scroll position between paints and would miss exactly
 * the thing being looked for: a single frame that moved 400px.
 */
const watch = `(async () => {
  const thread = document.querySelector('.lc-thread')
  if (thread === null) return 'no thread'
  const tops = []
  const heights = []
  let frames = 0
  await new Promise((done) => {
    let quiet = 0
    let began = false
    let startHeight = 0
    const tick = () => {
      frames += 1
      tops.push(thread.scrollTop)
      heights.push(thread.scrollHeight)
      if (frames === 1) startHeight = thread.scrollHeight
      const moved = tops.length > 1 && (tops[tops.length - 1] !== tops[tops.length - 2]
        || heights[heights.length - 1] !== heights[heights.length - 2])
      // The reply has BEGUN when the thread is taller than it was, not when
      // anything at all differs: the first frame trivially differs from
      // nothing, which is how the first two runs of this probe declared a
      // perfectly smooth stream of zero moving frames four seconds after
      // sending, before the runtime had said a word.
      if (thread.scrollHeight > startHeight + 4) began = true
      quiet = !began || moved ? 0 : quiet + 1
      // Four seconds of a completely still thread, at 60fps.
      if (quiet > 240) { done(); return }
      if (frames > 12000) { done(); return }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const jumps = []
  for (let i = 1; i < tops.length; i += 1) {
    const d = tops[i] - tops[i - 1]
    if (d > 0) jumps.push(d)
  }
  jumps.sort((a, b) => b - a)
  const total = jumps.reduce((sum, d) => sum + d, 0)
  const worstFive = jumps.slice(0, 5)
  const sum = (list) => list.reduce((s, d) => s + d, 0)
  return JSON.stringify({
    frames,
    movingFrames: jumps.length,
    totalTravel: Math.round(total),
    biggestJump: Math.round(jumps[0] ?? 0),
    worstFive: worstFive.map(Math.round),
    // The number that matches the complaint: if five frames carry most of the
    // travel, the reply did not come down -- it lurched.
    worstFiveShare: total === 0 ? 0 : Math.round((sum(worstFive) / total) * 100),
    medianJump: jumps.length === 0 ? 0 : Math.round(jumps[Math.floor(jumps.length / 2)]),
    finalHeight: Math.round(heights[heights.length - 1] ?? 0)
  }, null, 1)
})()`

const sendThenWatch = `(async () => {
  const sent = await ${send}
  if (sent !== 'sent') return 'NOT THE TEST: ' + String(sent)
  return await ${watch}
})()`

try {
  await drive.capture('a long reply comes down the thread', async () => {
    await drive.ready()
    return drive.evaluate(sendThenWatch)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet, asked for a long markdown answer. Every animation frame while it arrives, the thread’s scrollTop and scrollHeight: a reply that reads as smooth moves a line or two per frame, one that reads as twitchy lurches.'
  })
}
