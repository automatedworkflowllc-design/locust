// Does the smokes' completion detector still see a finished run?
//
//   node _tools/drive-smoke-detector.mjs
//
// Twelve smokes decide a run is over with the same three facts: the stop
// button was seen, the stop button is gone, and a .lc-thread__marker is on
// screen. Runs demonstrably finish -- Claude in 6s, OpenCode in 21s,
// read-only OpenCode in 44s, all reading "completed" in the workroom header
// (drives, 2026-09-07) -- yet those smokes still report
// {"started":true,"done":false}.
//
// So this watches ONE short run with both detectors side by side: the
// smokes' three facts, and the header's own word. Whichever disagrees with
// the app is the broken one.
//
// Spends one small Claude Code run.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-detector-ws-')
const drive = await startDrive({
  name: 'smoke-detector',
  port: 9329,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z'
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const BOTH_DETECTORS = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Reply with exactly the word SETTLED and nothing else. Do not read any files.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()

  let sawStop = false
  let headerSettledAt = null
  let smokeSettledAt = null
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const stop = document.querySelector('button[aria-label^="Stop the running"]')
    if (stop) sawStop = true
    const marker = document.querySelector('.lc-thread__marker')
    if (smokeSettledAt === null && sawStop && !stop && marker) smokeSettledAt = i + 1
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    if (headerSettledAt === null && /completed|failed|cancelled/i.test(text)) headerSettledAt = i + 1
    // Give the smokes' detector a few seconds past the header's verdict to
    // catch up before calling it stuck.
    if (headerSettledAt !== null && i + 1 > headerSettledAt + 8) break
  }

  const markers = [...document.querySelectorAll('.lc-thread__marker')].map((m) => m.innerText.split(/\\s+/).join(' ').slice(0, 60))
  const header = document.querySelector('.lc-workroom__header')
  return [
    'header said settled at: ' + (headerSettledAt === null ? 'NEVER' : headerSettledAt + 's'),
    'smoke detector said settled at: ' + (smokeSettledAt === null ? 'NEVER' : smokeSettledAt + 's'),
    'ever saw the stop button: ' + sawStop,
    'stop button now: ' + (document.querySelector('button[aria-label^="Stop the running"]') ? 'still present' : 'gone'),
    'thread markers now: ' + markers.length + (markers.length ? ' >> ' + markers.join(' ;; ') : ''),
    'header now: ' + (header ? header.innerText.split(/\\s+/).join(' ').slice(0, 130) : 'none')
  ].join('  ||  ')
})()`

try {
  await drive.capture('Wren on Claude Code / sonnet', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
  })

  await drive.capture('both detectors, watching the same run', () => drive.evaluate(BOTH_DETECTORS))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro:
      "The smokes' three-fact completion detector and the workroom header, watching one run together."
  })
}
