// The activity fold opens a file in the panel, not the file manager.
//
//   node _tools/fold-opens-file-drive.mjs [--keep]
//
// 0.203.0 gave a HANDED file a viewer. A handed file is a teammate choosing
// to give you one, and most files are not handed -- the ordinary way a person
// meets a file is the fold that says what the turn touched. Those rows only
// ever offered the file manager, so reading what a teammate had just written
// meant leaving the app.
//
// Live and free: one real exchange on the free OpenCode model, which is what
// produces a real fold with a real file row. It refuses to send on any other
// route.
//
// THIS IS ALSO THE FIRST DRIVE THAT WAITS ON CONDITIONS. Every other drive in
// this repository waits by guessing a fixed sleep, which is both where the
// flakes come from and where most of the wall clock goes. `waitFor` and
// `waitForSelector` landed in `drive-lib.mjs` alongside this file; a wait here
// that times out names what it was waiting for and what the screen last said.

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-foldfile-ws-')
const T0 = '2026-09-20T05:00:00.000Z'

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 200)}`}`)
}

const drive = await startDrive({
  name: 'fold-opens-file',
  port: 9518,
  workspace,
  spends: false,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_yurt', name: 'Yurt', hue: 'lime', role: 'Docs & QA', createdAt: T0, route: { ...FREE_ROUTE } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('ask for a file to be written', async () => {
    await drive.evaluate(`${teammateFace('Yurt')}?.click()`)
    /*
     * PICK THE ROUTE. A teammate's seeded route is not the composer's route
     * on a new conversation -- the first run of this drive learned that the
     * expensive way, sending its turn on Codex, which is Astra's quota. The
     * harness now refuses to start a non-spending drive on a paid route, and
     * this line is the drive saying which route it meant rather than relying
     * on that refusal to notice.
     */
    /*
     * Muse Spark BY NAME, not "any free row". The guard's fallback picks the
     * first free OpenCode model it finds, which on this machine is Jev 1.13
     * Free -- and Jev answered this drive's first free attempt with
     * "OpenCode stopped: Internal server error". Free is the spending rule;
     * which free model is a reliability question, and this repo's answer is
     * muse-spark.
     */
    const route = await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/free/i' }))
    check('the turn runs on a free route', /opencode/i.test(String(route)) && /\bfree\b/i.test(String(route)), route)
    return drive.evaluate(
      sendAndWaitScript('Create a file called notes.md containing exactly two lines: a markdown heading "# Notes" and the sentence "The kettle is on." Then reply with the single word DONE.')
    )
  })

  await drive.capture('the fold names the file it wrote', async () => {
    // Open the fold if the turn did not. A finished turn opens its own, so
    // an unconditional click would CLOSE it.
    await drive.evaluate(`(() => {
      const fold = document.querySelector('.lc-activity')
      if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
      return true
    })()`)
    return drive.waitForSelector('.lc-filerow__path', { what: 'a file row in the fold', timeoutMs: 15_000 })
  })

  await drive.capture('the row offers to open it', async () => {
    const title = await drive.waitFor(
      `(() => { const b = document.querySelector('.lc-filerow__view'); return b ? b.getAttribute('title') : false })()`,
      { what: 'the open control on a file row', timeoutMs: 10_000 }
    )
    check('the fold offers to open a file, not only to reveal it', /^Open /.test(String(title)), title)
    return title
  })

  await drive.capture('press it: the panel opens on that file', async () => {
    await drive.evaluate(`document.querySelector('.lc-filerow__view').click()`)
    const name = await drive.waitForSelector('.lc-viewer__name', { what: 'the viewer head', timeoutMs: 10_000 })
    check('the panel names the file that was pressed', /notes\.md/i.test(String(name)), name)
    const body = await drive.evaluate(`document.querySelector('.lc-viewer__scroll')?.innerText ?? ''`)
    check('the panel shows what the file says', /kettle/i.test(String(body)), String(body).slice(0, 120))
    // Markdown, so prose -- the heading must be a heading and not a hash.
    const prose = await drive.evaluate(`document.querySelector('.lc-viewer__prose') !== null`)
    check('a markdown file is rendered as prose', prose === true, `prose=${String(prose)}`)
    return String(name)
  })

  await drive.capture('the workroom is inset under it, not covered by it', () =>
    drive.evaluate(`(() => {
      const room = document.querySelector('.lc-workroom')
      const viewer = document.querySelector('.lc-viewer')
      if (!room || !viewer) return 'missing ' + (!room ? 'workroom' : 'viewer')
      const r = room.getBoundingClientRect()
      const v = viewer.getBoundingClientRect()
      const composer = document.querySelector('form.command-dock')?.getBoundingClientRect()
      const covered = composer !== undefined && composer.right > v.left && composer.left < v.right
      return 'room right ' + Math.round(r.right) + ', viewer left ' + Math.round(v.left) + ', composer overlaps viewer: ' + String(covered)
    })()`)
  )

  /*
   * A SECOND TURN ON THE SAME FILE, so the version strip has something real
   * in it. This is artifact support's (c) -- the turns of a conversation that
   * changed one file -- and it is a reading feature over what the ledger
   * already keeps, so the only way to see it is to make a conversation that
   * actually has two turns touching one file.
   */
  await drive.capture('ask for a second change to the same file', async () => {
    await drive.evaluate(`document.querySelector('.lc-viewer__close')?.click()`)
    return drive.evaluate(
      sendAndWaitScript('Add one more line to notes.md: "The door is shut." Then reply with the single word DONE.')
    )
  })

  await drive.capture('open it again: the strip says two turns', async () => {
    await drive.evaluate(`(() => {
      const fold = document.querySelector('.lc-activity')
      if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
      return true
    })()`)
    await drive.waitForSelector('.lc-filerow__view', { what: 'a file row to open', timeoutMs: 15_000 })
    await drive.evaluate(`document.querySelector('.lc-filerow__view').click()`)
    const label = await drive.waitForSelector('.lc-viewer__versionlabel', { what: 'the version strip', timeoutMs: 10_000 })
    check('the strip counts the turns that changed this file', /CHANGED IN \d+ TURNS?/.test(String(label)), label)
    const chips = await drive.evaluate(`[...document.querySelectorAll('.lc-viewer__version')].map(b => b.innerText).join(',')`)
    check('there is a numbered chip per turn, and a way back to the file', /Now/.test(String(chips)), chips)
    return `${String(label)} -- chips: ${String(chips)}`
  })

  await drive.capture('press a turn: it shows what that turn changed', async () => {
    await drive.evaluate(`document.querySelector('.lc-viewer__version').click()`)
    const note = await drive.waitForSelector('.lc-viewer__versionnote', { what: 'the version note', timeoutMs: 5_000 })
    check('the panel says the diff is a CHANGE, not the file', /changed/i.test(String(note)), note)
    const diff = await drive.evaluate(`document.querySelector('.lc-viewer__scroll')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? ''`)
    check('and it draws the hunks that turn made', /kettle|door|[+]/.test(String(diff)), diff)
    // Back to the document, which is where the panel opens.
    await drive.evaluate(`[...document.querySelectorAll('.lc-viewer__version')].find(b => b.innerText.trim() === 'Now')?.click()`)
    const back = await drive.waitFor(`document.querySelector('.lc-viewer__prose') !== null`, { what: 'the file itself to come back', timeoutMs: 5_000 })
    check('Now brings the file back', back === true)
    return String(note)
  })

  /*
   * THE PROPORTIONS, AT THREE WINDOWS, because that is the open question and
   * it is the design agent's. The width is `clamp(360px, 38vw, 560px)`, taken
   * off Colin's own Claude Code frame where the panel is about 40% of the
   * window -- a measurement of ONE window, which is exactly the kind of
   * number that reads as settled and is not. 1120x720 is the size at which
   * the drawer used to cover the composer (fixed in 0.187.0); 1600x1000 is
   * where the clamp stops growing and the panel starts shrinking as a share.
   */
  for (const [width, height] of [[1120, 720], [1600, 1000]]) {
    await drive.capture(`the panel at ${String(width)} by ${String(height)}`, async () => {
      await drive.resize(width, height)
      return drive.evaluate(`(() => {
        const viewer = document.querySelector('.lc-viewer')
        /*
         * THE WIDEST thread, not the first. A conversation of two turns draws
         * one thread element per turn, and querySelector took whichever came
         * first -- which reported 426px on a run whose conversation was
         * plainly 630px wide in its own frame. A measurement that picks one
         * of N without saying so is a measurement of nothing.
         */
        const threads = [...document.querySelectorAll('.lc-thread')]
        const composer = document.querySelector('form.command-dock')
        if (!viewer) return 'no viewer'
        const v = viewer.getBoundingClientRect()
        const t = threads.length === 0 ? null : threads.map(el => el.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0]
        const c = composer ? composer.getBoundingClientRect() : null
        const share = Math.round((v.width / window.innerWidth) * 100)
        const prose = document.querySelector('.lc-viewer__prose p')
        return JSON.stringify({
          window: window.innerWidth + 'x' + window.innerHeight,
          viewer: Math.round(v.width),
          shareOfWindow: share + '%',
          thread: t ? Math.round(t.width) : null,
          composerCovered: c !== null && c.right > v.left && c.left < v.right,
          proseWidth: prose ? Math.round(prose.getBoundingClientRect().width) : null
        })
      })()`)
    })
  }
  await drive.resize(1280, 860)

  /*
   * HOW MANY CHARACTERS THE PANEL ACTUALLY RENDERS, swept across candidate
   * widths. The design agent's ruling of 2026-09-20 threw out 38vw for a
   * reason worth keeping: a percentage is a different MEASURE at every window
   * size, and a measure is the thing a document wants. Its instruction was to
   * target a rendered 62-68 characters and work backwards to the pixels --
   * and to count the rendered column rather than trust the `ch` unit, since
   * at 15px this serif's zero runs wide and `ch` overstates.
   *
   * IT COUNTS A PARAGRAPH IT PUTS THERE ITSELF, which is a claim about the
   * BOX and not about any file: the question is how many characters this
   * column fits, and the answer must not depend on which file happened to be
   * open. The counting is `prose-size-measure.mjs`'s -- one character at a
   * time through a Range, grouped by the top of its rect, because a line box
   * is the only thing that knows where a line broke.
   */
  await drive.capture('how many characters the panel renders, by width', async () => {
    await drive.resize(1600, 1000)
    return drive.evaluate(`(() => {
      const prose = document.querySelector('.lc-viewer__prose')
      if (!prose) return 'no prose column'
      const sentence = 'The teammate wrote this paragraph so the column could be measured rather than guessed, and it runs on for long enough that several lines break inside it. '
      prose.innerHTML = ''
      const p = document.createElement('p')
      p.className = 'lc-para'
      p.textContent = sentence.repeat(6)
      prose.appendChild(p)
      const root = document.documentElement
      const was = root.style.getPropertyValue('--lc-viewer-width')
      const count = () => {
        const node = p.firstChild
        const range = document.createRange()
        const byLine = new Map()
        for (let i = 0; i < node.textContent.length; i += 1) {
          range.setStart(node, i); range.setEnd(node, i + 1)
          const top = Math.round(range.getBoundingClientRect().top)
          byLine.set(top, (byLine.get(top) || 0) + 1)
        }
        const lines = [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n).slice(0, -1)
        return {
          columnPx: Math.round(p.getBoundingClientRect().width),
          mean: lines.length ? Math.round(lines.reduce((a, b) => a + b, 0) / lines.length) : 0,
          longest: lines.length ? Math.max(...lines) : 0
        }
      }
      const out = []
      for (const width of [420, 460, 500, 540, 560, 600, 640, 680]) {
        root.style.setProperty('--lc-viewer-width', width + 'px')
        const reading = count()
        out.push(width + 'px -> ' + reading.columnPx + 'px column, ' + reading.mean + ' chars mean, ' + reading.longest + ' longest')
      }
      root.style.setProperty('--lc-viewer-width', was)
      return out.join(' | ')
    })()`)
  })
  await drive.resize(1280, 860)

  await drive.capture('close it and the panel is gone', async () => {
    // ASSERT IT IS THERE FIRST. "The viewer is gone" is trivially true when
    // the viewer never opened, and on this drive's second run every earlier
    // step had thrown while this one still reported PASS.
    const open = await drive.evaluate(`document.querySelector('.lc-viewer') !== null`)
    check('the panel was open before this step closed it', open === true)
    if (open !== true) return 'nothing to close'
    await drive.evaluate(`document.querySelector('.lc-viewer__close').click()`)
    const gone = await drive.waitFor(
      `document.querySelector('.lc-viewer') === null`,
      { what: 'the viewer to close', timeoutMs: 5_000 }
    )
    check('the panel closes', gone === true)
    return 'closed'
  })
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  /*
   * A STEP THAT THREW IS A FAILURE. `capture` catches, records "threw: ..."
   * and carries on, which is right for keeping the record -- but the drive
   * used to read only its own `check` calls, so a run where every wait timed
   * out still printed "all checks passed".
   */
  const threw = drive.record.filter((row) => /^threw: /.test(String(row.note)))
  threw.forEach((row) => check(`step ${String(row.step)} (${row.title}) completed`, false, row.note))
  say(failures === 0 ? '\nall checks passed' : `\n${String(failures)} check(s) failed`)
  await drive.finish({
    intro: 'Yurt on the free OpenCode model. One file written, then opened from the activity fold rather than from a handover.'
  })
  process.exitCode = failures === 0 ? 0 : 1
}
