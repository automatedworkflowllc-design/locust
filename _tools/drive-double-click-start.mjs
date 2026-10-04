// A double-click on Start starts the run and does not stop it (0.456, QA-2026-09-29 Q6).
//
//   node _tools/drive-double-click-start.mjs [--packaged <exe>]
//
// Start and Stop are one button in one place, so the second click of a
// double-click landed on Stop and the run ended "You stopped this run" before
// anything ran. This clicks Start, then clicks the SAME POINT on screen again
// 150 ms later, as a double-click does, and reads how the run ended. Then a
// second message is stopped on purpose two seconds in: Stop must still work.

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await scratchRepository('locust-drive-dblclick-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'double-click-start',
  port: 9649,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

/** Type, press Start, and after `secondAfterMs` click whatever is now at the same point. */
const startThenClickAgain = (text, secondAfterMs) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  let start
  for (let i = 0; i < 120 && !start; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) start = button
  }
  if (!start) return JSON.stringify({ sent: false })
  const box = start.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  start.click()
  await new Promise((r) => setTimeout(r, ${String(secondAfterMs)}))
  const under = document.elementFromPoint(x, y)?.closest('button')
  const second = under?.getAttribute('aria-label') ?? ''
  under?.click()
  for (let i = 0; i < 720; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 800))
  const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
  return JSON.stringify({ sent: true, second, stopped: /You stopped this run/i.test(thread), tail: thread.slice(-200) })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  const double = JSON.parse(String(await drive.capture('double-click on Start', () => drive.evaluate(startThenClickAgain('Reply with the single word PELICAN.', 150)))))
  check('the second click landed on Stop, as a double-click does', /^Stop the running/.test(double.second), double.second)
  check('and the run was not stopped: it answered', double.sent && !double.stopped && /PELICAN/.test(double.tail), JSON.stringify({ stopped: double.stopped, tail: double.tail.slice(-80) }))
  const meant = JSON.parse(String(await drive.capture('Stop pressed on purpose, two seconds in', () => drive.evaluate(startThenClickAgain('Count slowly from 1 to 200, one number per line.', 2000)))))
  check('a Stop pressed on purpose still stops the run', meant.sent && /^Stop the running/.test(meant.second) && meant.stopped, JSON.stringify({ second: meant.second, stopped: meant.stopped, tail: meant.tail.slice(-80) }))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
