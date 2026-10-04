// Eight turns in one thread, and whether it is still readable at the end.
//
//   node _tools/drive-long-conversation.mjs
//
// Every drive here sends one turn, or two. A person has a conversation.
//
// There is a specific reason to look. `openByDefault` used to be true for the
// NEWEST finished turn only, and its comment said why: "Every finished fold
// opening would make a long conversation a wall of tool rows, which is what
// the fold is for." On 2026-09-08 I changed it to ANY finished turn, because
// sending a follow-up was closing a fold the person was reading -- a real
// defect, measured. But the wall that comment warned about has never been
// looked at, because nothing in this repository has ever held a long
// conversation.
//
// So: eight turns, each doing a little real work, then read the thread. The
// questions are how tall it gets, how many tool rows are on screen at once,
// whether the newest turn is still where the eye lands, and whether anything
// earlier is lost.
//
// Free OpenCode model, packaged binary, throwaway profile. Costs nothing.
//
//   node _tools/drive-long-conversation.mjs [--model <words>] [--packaged <exe> | --local] [--out <dir>]
//
// --model picks the free row whose name has those words ("lightning"): on
// 2026-09-23 most free models hung and the first free row was one of them.
// B2's confirmation is every turn ending at the bottom (Yurt's #3: from turn
// 5 of 8 the thread stopped following); the drive now says so as a check.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const MODEL = arg('--model') ?? 'free'
const LOCAL = process.argv.includes('--local')
const EXE = arg('--packaged') ?? join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!LOCAL && !existsSync(EXE)) {
  say(`no packaged build at ${EXE} -- run \`pnpm --filter @teammate/desktop package\` first`)
  process.exit(1)
}
const OUT = arg('--out')
// A slow free model outlasts 90 s a turn, and the next turn then queues
// behind it rather than being read as a finished one.
const TURN_MS = Number(arg('--turn-seconds') ?? '90') * 1000

/** Eight small, real tasks. Each leaves a file, so each turn has a fold. */
const TURNS = [
  'Create notes/one.txt containing the word ALPHA. Then say ONE.',
  'Create notes/two.txt containing the word BRAVO. Then say TWO.',
  'Create notes/three.txt containing the word CHARLIE. Then say THREE.',
  'Create notes/four.txt containing the word DELTA. Then say FOUR.',
  'Create notes/five.txt containing the word ECHO. Then say FIVE.',
  'Create notes/six.txt containing the word FOXTROT. Then say SIX.',
  'Create notes/seven.txt containing the word GOLF. Then say SEVEN.',
  'List the files in notes/ and tell me how many there are. Then say EIGHT.'
]

const workspace = await scratchRepository('locust-long-ws-')
const drive = await startDrive({
  name: 'long-conversation',
  port: 9427,
  ...(LOCAL ? {} : { packaged: EXE }),
  ...(OUT === undefined ? {} : { outPath: OUT }),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** How the thread is holding up, in numbers a person would feel. */
const SHAPE = `(() => {
  const thread = document.querySelector('.lc-thread')
  if (thread === null) return JSON.stringify({ error: 'no thread' })
  const folds = [...document.querySelectorAll('.lc-activity')]
  const open = folds.filter((el) => el.getAttribute('aria-expanded') === 'true')
  const scroller = document.querySelector('.lc-thread__column')?.parentElement ?? thread
  return JSON.stringify({
    turns: document.querySelectorAll('.lc-bubble, .lc-userline').length,
    folds: folds.length,
    foldsOpen: open.length,
    toolRowsOnScreen: [...document.querySelectorAll('.lc-filerow')].filter((el) => {
      const box = el.getBoundingClientRect()
      return box.bottom > 0 && box.top < window.innerHeight
    }).length,
    toolRowsTotal: document.querySelectorAll('.lc-filerow').length,
    threadPixels: Math.round(thread.scrollHeight),
    viewportPixels: window.innerHeight,
    scrolledToBottom: Math.abs(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) < 40,
    running: document.querySelector('button[aria-label^="Stop the running"]') !== null,
    lastWords: (thread.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(-90)
  })
})()`

try {
  await drive.capture('open a teammate on the free model', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: MODEL, row: `/${MODEL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/i` }))
    return `route is ${String(await drive.evaluate(`(() => {
      const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
      return (c?.textContent ?? '').trim()
    })()`))}`
  })

  // The guard that stops this walking on a paid runtime. Outside `capture`,
  // because capture records a throw as a note and carries on.
  const route = String(await drive.evaluate(`(() => {
    const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
    return (c?.textContent ?? '').trim()
  })()`))
  if (!/opencode/i.test(route) || !/free/i.test(route)) throw new Error(`route is ${JSON.stringify(route)} -- refusing anything but a free OpenCode model`)
  say(`route: ${route}`)

  const atBottom = []
  for (const [index, text] of TURNS.entries()) {
    const number = index + 1
    const shape = await drive.capture(`turn ${String(number)} of ${String(TURNS.length)}`, async () => {
      await drive.evaluate(`(async () => {
        const box = document.querySelector('textarea[aria-label="Message"]')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        setter.call(box, ${JSON.stringify(text)})
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 250))
        box.focus()
        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        for (let waited = 0; waited < ${TURN_MS}; waited += 500) {
          await new Promise((r) => setTimeout(r, 500))
          if (waited > 3000 && document.querySelector('button[aria-label^="Stop the running"]') === null) break
        }
        await new Promise((r) => setTimeout(r, 1200))
        return 'settled'
      })()`)
      return drive.evaluate(SHAPE)
    })
    const read = (() => {
      try {
        return JSON.parse(String(shape))
      } catch {
        return {}
      }
    })()
    // No thread at all is the conversation gone from the screen -- 0.297's
    // turn 5, dropped by a host still winding turn 4 down -- not a slow turn.
    const gone = read.error !== undefined
    atBottom.push({ bottom: read.scrolledToBottom === true, finished: read.running === false, gone })
    say(`turn ${String(number)}: ${gone ? 'NO CONVERSATION ON SCREEN (' + String(read.error) + ')' : read.running === false ? 'finished' : 'STILL RUNNING'}, ${read.scrolledToBottom === true ? 'at the bottom' : 'NOT at the bottom'} -- ${String(read.lastWords ?? '').slice(-50)}`)
  }

  await drive.capture('the whole conversation, at the end', async () => {
    return drive.evaluate(SHAPE)
  })
  const lost = atBottom.filter((turn) => turn.gone).length
  if (lost > 0) say(`  [FAIL] the conversation stays on screen through every turn -- it was gone at ${String(lost)} read(s)`)
  const finished = atBottom.filter((turn) => turn.finished)
  const held = finished.filter((turn) => turn.bottom).length
  if (finished.length < TURNS.length) say(`  [NOTE] ${String(TURNS.length - finished.length)} turn(s) were still running when read -- they prove nothing either way`)
  say(`  [${held === finished.length && finished.length === TURNS.length ? 'PASS' : held < finished.length ? 'FAIL' : 'INCONCLUSIVE'}] every finished turn ends with the thread at its newest reply -- ${String(held)}/${String(finished.length)} finished (${String(TURNS.length)} sent)`)

  await drive.capture('scrolled back to the first turn', async () => {
    return drive.evaluate(`(async () => {
      const scroller = document.querySelector('.lc-thread__column')?.parentElement ?? document.querySelector('.lc-thread')
      if (scroller !== null) scroller.scrollTop = 0
      await new Promise((r) => setTimeout(r, 700))
      const first = document.querySelector('.lc-filerow')
      return JSON.stringify({
        atTop: scroller === null ? null : scroller.scrollTop < 20,
        firstRowVisible: first === null ? null : first.getBoundingClientRect().top < window.innerHeight
      })
    })()`)
  })
} finally {
  await drive.finish({
    intro: 'Eight turns in one thread on the free model, to see what a long conversation looks like now that every finished turn keeps its fold open.'
  })
}

say('done')
