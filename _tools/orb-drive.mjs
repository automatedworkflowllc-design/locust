// The thinking orb on the running step, watched happening.
//
//   node _tools/orb-drive.mjs [--keep]
//
// The orb is MAPPED to the work rather than cycled (design agent's ruling,
// 2026-09-20), and the whole claim is that it cannot contradict the row it
// sits on. `the-orb-never-contradicts-the-row.test.ts` pins the mapping
// function; this pins that the mapping reaches the screen at all, which a
// unit test cannot see.
//
// It catches the orb MID-RUN, which is the only time it exists -- so it polls
// the live step while a real turn is going and keeps every distinct state it
// sees, with the row's own words beside it. If the orb ever said `searching`
// next to a shell command, this is where it would show.
//
// Live and free: one turn on the free OpenCode model.

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-orb-ws-')
const T0 = '2026-09-20T05:00:00.000Z'

let failures = 0
let sending
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 220)}`}`)
}

const drive = await startDrive({
  name: 'orb',
  port: 9519,
  workspace,
  spends: false,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { ...FREE_ROUTE } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

/*
 * Watch the live step while the turn runs, in the PAGE, because the orb only
 * exists between two events and a screenshot taken afterwards would find
 * nothing. Keeps one record per distinct (orb state, register, words) it
 * sees -- which is also exactly the evidence for "it never contradicts".
 */
const WATCH = `(async () => {
  window.__orbSeen = []
  const tick = () => {
    const step = document.querySelector('.lc-livestep')
    if (step) {
      const well = step.querySelector('.lc-livestep__orb')
      const orb = well ? well.querySelector('canvas') : null
      const words = (step.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90)
      const register = step.getAttribute('data-register')
      const seen = orb === null ? 'none' : (well.getAttribute('data-orb') || 'orb')
      const key = seen + '|' + register + '|' + words
      if (!window.__orbSeen.some(r => r.key === key)) {
        window.__orbSeen.push({ key, orb: seen, register, words, painted: orb === null ? null : orb.width + 'x' + orb.height })
      }
    }
    window.__orbTimer = setTimeout(tick, 120)
  }
  tick()
  return 'watching'
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('start a turn that reads and then runs a command', async () => {
    await drive.evaluate(`${teammateFace('Wren')}?.click()`)
    const route = await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/free/i' }))
    check('the turn runs on a free route', /opencode/i.test(String(route)) && /\bfree\b/i.test(String(route)), route)
    await drive.evaluate(WATCH)
    /*
     * A SLOW command on purpose. The first version of this drive asked for a
     * read and an `echo`, and the run did both -- the fold shows them -- while
     * the live step never left `working`. Each tool was open for milliseconds,
     * so there was no frame in which an orb could exist. A feature that only
     * appears while a tool is OPEN has to be measured against a tool that
     * stays open, or the measurement is of the sampling rate.
     */
    /*
     * NOT AWAITED YET. `capture` photographs after its action returns, and
     * the orb exists only WHILE the turn runs -- so awaiting the send here
     * would guarantee every frame was taken after the one thing being
     * measured had stopped. The first version of this drive did exactly that
     * and produced three screenshots of a finished conversation.
     */
    sending = drive.evaluate(
      sendAndWaitScript('Run exactly this one command and nothing else: powershell -Command "Start-Sleep -Seconds 8". Then reply with the single word DONE.')
    )
    return 'sent'
  })

  await drive.capture('the orb, while the turn is still running', async () => {
    const seen = await drive.waitFor(
      `(() => { const w = document.querySelector('.lc-livestep__orb'); const c = w ? w.querySelector('canvas') : null; return c ? (w.getAttribute('data-orb') || 'orb') + ' ' + c.width + 'x' + c.height : false })()`,
      { what: 'an orb on the live step', timeoutMs: 30_000 }
    )
    check('an orb is on screen mid-run', /\d+x\d+/.test(String(seen)), seen)
    return String(seen)
  })

  await drive.capture('the sidebar row and the plan carry one too', async () => {
    /*
     * Three surfaces, one claim. The live line, the sidebar's running
     * conversation and the plan's running step all say "this is going", so
     * all three carry an orb -- and the sidebar's is the one that has to sit
     * in a 6px well without moving the row, which is a thing only a real
     * render can show.
     */
    const seen = await drive.evaluate(`(() => {
      const row = document.querySelector('.lc-row__orb canvas')
      const plan = document.querySelector('.lc-plan__orb canvas')
      const rowBox = row ? row.closest('.lc-row__orb').getBoundingClientRect() : null
      return JSON.stringify({
        sidebar: row ? row.width + 'x' + row.height : 'none',
        sidebarWell: rowBox ? Math.round(rowBox.width) : null,
        // What the eye gets, not what the canvas holds. The library's
        // smallest orb is 20px and resolvePreset throws on anything else, so
        // the row's is scaled down in CSS -- which the canvas's own width
        // property cannot see, because that is device pixels at full
        // resolution. Only the painted box knows. (No backticks in here: a
        // backtick in a page script's comment closes this template literal,
        // and the repo has a guard for exactly that.)
        sidebarDrawn: row ? Math.round(row.getBoundingClientRect().width) : null,
        planStep: plan ? plan.width + 'x' + plan.height : 'none'
      })
    })()`)
    const read = JSON.parse(String(seen))
    check('the running conversation row carries an orb', read.sidebar !== 'none', seen)
    check('and it does not widen the row', read.sidebarWell === 6, `well ${String(read.sidebarWell)}px`)
    check('it is drawn smaller than the face beside it', read.sidebarDrawn !== null && read.sidebarDrawn < 16, `drawn ${String(read.sidebarDrawn)}px`)
    return seen
  })

  await drive.capture('the turn finishes', async () => {
    const answer = await sending
    return String(answer).slice(0, 160)
  })

  await drive.capture('what the orb said, and what the row said with it', async () => {
    await drive.evaluate(`clearTimeout(window.__orbTimer)`)
    const seen = JSON.parse(await drive.evaluate(`JSON.stringify(window.__orbSeen ?? [])`))
    for (const row of seen) say(`     ${String(row.orb).padEnd(12)} register=${String(row.register).padEnd(10)} ${String(row.words).slice(0, 70)}`)

    const withOrb = seen.filter((row) => row.orb !== 'none')
    check('the orb reached the screen during a real run', withOrb.length > 0, `${String(seen.length)} live-step states seen`)
    /*
     * ONLY IF THERE WAS ONE. "Every orb painted" and "no orb contradicted"
     * are both trivially true of an empty set, and on this drive's first run
     * both reported PASS while the orb had never appeared at all. A check
     * that passes because the feature is absent is worse than no check.
     */
    if (withOrb.length === 0) {
      say('     (no orb was drawn, so the two checks about orbs are not being made)')
    } else {
      check('every orb drawn actually painted a canvas', withOrb.every((row) => row.painted !== null && row.painted !== '0x0'), withOrb.map((r) => r.painted).join(','))
    }

    /*
     * THE CONTRADICTION CHECK, which is the point of the whole feature.
     * A shell register must never carry the reading orb, and vice versa.
     */
    /*
     * READ OFF `data-orb`, WHICH IS OURS, not the library's `aria-label`.
     *
     * `ThinkingOrb` labels its canvas from its own state name, and since
     * 2026-09-20 those names are an ALLOCATION of shapes to rows rather than
     * a description of them -- so the label stopped agreeing with the row by
     * construction, and this check was about to start comparing a string that
     * no longer meant anything here. Nobody hears it either way: the canvas is
     * aria-hidden and the row's own words are the accessible name.
     *
     * The RULE is unchanged and is the point of the whole feature: the
     * reading orb never sits on a command, and the tool orb never sits on a
     * read. Those are the two things the mapping actually promises.
     */
    const wrong = withOrb.filter((row) => {
      const state = String(row.orb).toLowerCase()
      if (state === 'searching' && /shell|command/i.test(String(row.words))) return true
      if (state === 'listening' && /\bread\b|grep|view_file/i.test(String(row.words))) return true
      return false
    })
    if (withOrb.length > 0) {
      check('no orb contradicted the words beside it', wrong.length === 0, wrong.map((r) => r.key).join(' || '))
    }
    return seen.map((r) => `${String(r.orb)}:${String(r.register)}`).join(' → ')
  })
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const threw = drive.record.filter((row) => /^threw: /.test(String(row.note)))
  threw.forEach((row) => check(`step ${String(row.step)} (${row.title}) completed`, false, row.note))
  say(failures === 0 ? '\nall checks passed' : `\n${String(failures)} check(s) failed`)
  await drive.finish({ intro: 'Wren on the free OpenCode model. The thinking orb on the running step, polled while the turn ran.' })
  process.exitCode = failures === 0 ? 0 : 1
}
