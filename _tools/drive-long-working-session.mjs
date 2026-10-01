// A long conversation where every turn actually WORKS.
//
//   node _tools/drive-long-working-session.mjs
//
// `drive-long-session.mjs` runs fifteen turns and measures heap, nodes and
// ledger growth -- but its prompts are "reply with the word ACK1", so no turn
// calls a tool, no activity fold is ever drawn, and it reported `foldsTotal:
// 0` for all fifteen. Reassuring, and about nothing.
//
// This is the question that needs answering. 0.49.0 made every FINISHED turn
// keep its work on screen, reversing a deliberate rule -- "leaves EARLIER
// turns closed, so a long conversation is not a wall". That rule was overruled
// because the old behaviour CLOSED a fold the person was reading, which is a
// worse harm. But the wall worry was never wrong, and nobody has looked past
// two turns since.
//
// So: twelve turns, each one editing a file, so each leaves a real fold with
// real rows. Then measure how much scrolling sits between the top of the
// thread and the composer. If that climbs turn on turn, the wall is real and
// the fold rule needs a bound.
//
// Free OpenCode model. Nothing is spent.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const TURNS = 12
const workspace = await scratchRepository('locust-drive-longwork-ws-')

const drive = await startDrive({
  name: 'long-working-session',
  port: 9399,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** What a long thread costs, in the terms the fold decision turns on. */
const reading = `(() => {
  /*
   * Find the element that ACTUALLY scrolls, rather than guessing at a parent.
   *
   * The first version of this read .lc-thread's parentElement and computed
   * scrollHeight/clientHeight = 1 for all twelve turns, while node count
   * tripled. A ratio of exactly 1 across a growing thread does not mean "no
   * wall", it means the measured element does not scroll -- the same
   * false-green this repo keeps paying for. The screenshot showed a scrollbar.
   */
  const scroller = [...document.querySelectorAll('*')]
    .filter((el) => el.scrollHeight > el.clientHeight + 40)
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
  const folds = [...document.querySelectorAll('.lc-activity')]
  const memory = performance.memory
  return {
    foldsTotal: folds.length,
    foldsOpen: folds.filter((f) => f.getAttribute('aria-expanded') === 'true').length,
    fileRows: document.querySelectorAll('.lc-filerow').length,
    // How many windows of scrolling the thread has become.
    scrollerFound: scroller !== undefined,
    scrollerClass: scroller === undefined ? null : String(scroller.className).slice(0, 40),
    screens: scroller === undefined ? null : Math.round((scroller.scrollHeight / Math.max(1, scroller.clientHeight)) * 10) / 10,
    nodes: document.getElementsByTagName('*').length,
    heapMb: memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1048576)
  }
})()`

const send = (text) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Message"]')
  // A missing composer used to throw inside setter.call, which surfaces as a
  // stack trace attributed to the evaluate rather than as "the screen this
  // drive expected was not there". Name it.
  if (!box) return 'NO COMPOSER: textareas present: ' + document.querySelectorAll('textarea').length
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  /*
   * PRESS THE BUTTON A PERSON PRESSES.
   *
   * This dispatched a bare Enter keydown, which only works while the
   * composer's own key handler is what starts a mission -- so the day a
   * disabled-send rule or a different handler lands, the drive stops sending
   * and reports twelve turns of "done" over a thread that never moved.
   * Clicking the real control also waits for it to become ENABLED, which is
   * the send-blocked state this app now has. Enter stays as the fallback so
   * the drive still runs if the button is renamed.
   */
  let started = false
  for (let i = 0; i < 120; i += 1) {
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); started = true; break }
    await new Promise(r => setTimeout(r, 250))
  }
  if (!started) {
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }
  /*
   * WAIT ON THE STOP BUTTON, not on header text.
   *
   * The header was matched for /running|starting/, so a header that words it
   * differently -- or a turn whose header has not been written yet when the
   * first poll lands -- reads as finished immediately. The Stop button exists
   * for exactly as long as a run does; its absence is the fact, not a word.
   */
  const stopping = () => document.querySelector('button[aria-label^="Stop the running"]') !== null
  for (let i = 0; i < 60 && !stopping(); i += 1) await new Promise(r => setTimeout(r, 250))
  for (let i = 0; i < 360; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (!stopping()) return started ? 'done' : 'done (sent with Enter)'
  }
  return 'still running'
})()`

const trend = []

try {
  await drive.capture('launch, on a free model', async () => {
    await drive.ready()
    /*
     * MATCH ON THE NAME, and read `aria-label` as well as `title`.
     *
     * This looked for a title STARTING "Message Wren". MEASURED on the
     * packaged 0.249.0 build: the button reads
     * `Wren — open their conversation`. So the find returned undefined, the
     * optional call swallowed it silently, and the drive went on to pick a
     * route in whatever screen it happened to be on -- the exact failure
     * `drive-routine.mjs` still throws on at its step 2.
     */
    await drive.evaluate(`(async () => {
      const buttons = [...document.querySelectorAll('button')]
      const who = buttons.find(b => /Wren/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '')))
      if (!who) return 'NO TEAMMATE BUTTON: ' + buttons.map(b => b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '').filter(Boolean).join(' / ').slice(0, 300)
      who.click()
      await new Promise(r => setTimeout(r, 600))
      return 'opened'
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  for (let turn = 1; turn <= TURNS; turn += 1) {
    // Each turn writes its own file, so each leaves a fold with rows in it.
    const outcome = await drive.evaluate(send(`Create a file named note-${String(turn)}.txt containing exactly the line: entry ${String(turn)}. Use your file tools. Say DONE when finished.`))
    const seen = JSON.parse(await drive.evaluate(`JSON.stringify(${reading})`))
    trend.push({ turn, outcome: String(outcome), ...seen })
    if (turn === 1 || turn === 6 || turn === TURNS) {
      await drive.capture(`after turn ${String(turn)}`, () =>
        `${String(seen.foldsOpen)}/${String(seen.foldsTotal)} folds open · ${String(seen.fileRows)} file rows · ${String(seen.screens)} screens to scroll · ${String(seen.nodes)} nodes · heap ${String(seen.heapMb)}MB`)
    }
  }

  await drive.capture('THE WALL QUESTION: does scrolling grow with turns', () => {
    const first = trend[0]
    const last = trend[trend.length - 1]
    return `turn 1: ${String(first.screens)} screens, ${String(first.fileRows)} rows || turn ${String(last.turn)}: ${String(last.screens)} screens, ${String(last.fileRows)} rows || every screens value: ${trend.map((t) => t.screens).join(', ')}`
  })

  await drive.capture('is the newest turn reachable without hunting', () => drive.evaluate(`(() => {
    // The thing that actually matters: after a long session, is the person
    // looking at the newest work, or at the top of a wall?
    //
    // Found the same way the measurement above finds it. This line used to
    // read .lc-thread's parentElement -- the very element the comment on the
    // reading script says does not scroll, and whose ratio of exactly 1 is
    // the false-green that comment was written about. Two ways of finding
    // one element, one of them already known to be wrong.
    const scroller = [...document.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 40)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
    if (scroller === undefined) return 'no element on this screen scrolls'
    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    return 'pixels above the bottom: ' + Math.round(fromBottom) + (fromBottom < 80 ? ' (pinned to the newest turn)' : ' (NOT at the newest turn)')
  })()`))

  drive.record.push({ step: drive.record.length + 1, title: 'every turn measured', note: JSON.stringify(trend), errors: [] })
} finally {
  await drive.finish({
    intro: 'Twelve turns that each edit a file, so every turn leaves a real activity fold. Measures whether keeping finished folds open turns a long conversation into a wall.'
  })
}

say('done')
