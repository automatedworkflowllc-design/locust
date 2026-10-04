// Does the thread keep following its newest line? Replayed in the real app.
//
//   LOCUST_SPEND=1 node _tools/drive-thread-follows.mjs [--packaged <exe>] [--tag <name>]
//
// Yurt's beta report, 2026-09-23 (#3): "from turn 5 of 8 onward the thread no
// longer sits at the bottom after a reply". Logged the same day, event by
// event, through three turns on the free model: the walk reached the bottom,
// the content grew 136px, and a scroll event arrived with the scroll position
// UNCHANGED and no input anywhere -- the follow hook read it as the person
// scrolling up, stopped, and raised the jump arrow.
//
// The free model stalls often enough that eight real turns are not a reliable
// test, and Haiku's turns never produce the stray event. So this replays the
// logged sequence in the running app, against the real hook: one Haiku turn
// for a real thread, then
//
//   A. the content grows with no render of the thread (a fold laying itself
//      out does this) -- it must be followed;
//   B. the content grows and a scroll event arrives with the position
//      unchanged -- the logged case -- it must STILL be followed, with no
//      jump arrow;
//   C. the view is moved up, as a person moves it -- it must stop, and stay.
//
// What it does NOT do is reproduce the bug: against 0.286.0, which has it,
// all four passed as well -- other renders of the running thread fill in for
// the follow the replay withholds. So this guards the fix (C above all: a
// follow that could not be left would be worse than the bug); the bug itself
// was reproduced only on the free model, eight turns on 0.286.0
// (docs/beta-fixes-2026-09-23/b2-reproduced-on-0286-free-model).

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const drive = await startDrive({
  name: `thread-follows-${tag}`,
  port: 9415,
  workspace: await scratchRepository('locust-drive-follow-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const STATE = `(() => {
  const box = document.querySelector('.lc-thread')
  return JSON.stringify({
    dist: box === null ? -1 : Math.round(box.scrollHeight - box.scrollTop - box.clientHeight),
    arrow: document.querySelector('.lc-jumpdown') !== null
  })
})()`
const state = async () => JSON.parse(await drive.evaluate(STATE))
/** Grow the thread from outside React: a block appended to its column. */
const grow = (height, thenScrollEvent) => drive.evaluate(`(async () => {
  const box = document.querySelector('.lc-thread')
  const column = box?.querySelector('.lc-thread__column')
  if (!column) return 'no thread column'
  const block = document.createElement('div')
  block.style.height = '${String(height)}px'
  block.setAttribute('data-drive-grown', '')
  column.appendChild(block)
  ${thenScrollEvent ? "box.getBoundingClientRect(); box.dispatchEvent(new Event('scroll'))" : ''}
  await new Promise((r) => setTimeout(r, 1500))
  return 'grown'
})()`)

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise((r) => setTimeout(r, 500)) })()`)
  await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/haiku/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  say(`route: ${route}`)
  await drive.capture('one Haiku turn, for a real thread', () => drive.evaluate(sendAndWaitScript('Reply with exactly the word READY.', { waitSeconds: 180 })))
  await new Promise((r) => setTimeout(r, 1500))
  const before = await state()
  check('the thread starts at its bottom', before.dist >= 0 && before.dist <= 8 && !before.arrow, JSON.stringify(before))

  await grow(320, false)
  const a = await state()
  check('A. growth the thread did not render is followed', a.dist <= 8 && !a.arrow, JSON.stringify(a))

  await grow(320, true)
  const b = await drive.capture('B. growth, then a scroll event with the position unchanged', () => state().then((s) => JSON.stringify(s)))
  const bs = JSON.parse(b)
  check('B. a scroll nobody made does not stop the follow', bs.dist <= 8 && !bs.arrow, JSON.stringify(bs))

  await drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-thread')
    box.scrollTop = Math.max(0, box.scrollTop - 500)
    await new Promise((r) => setTimeout(r, 1500))
    return 'moved up'
  })()`)
  const c = await drive.capture('C. moved up, as a person moves it', () => state().then((s) => JSON.stringify(s)))
  const cs = JSON.parse(c)
  check('C. moving up stops the follow, and the view stays where it was put', cs.dist > 120 && cs.arrow, JSON.stringify(cs))
  say(failures === 0 ? '\nTHREAD FOLLOWS PASSED' : `\nTHREAD FOLLOWS: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'The thread follow, replayed against the real hook: growth with no render, growth and a stray scroll event, and a move up. One Haiku turn.' })
}
