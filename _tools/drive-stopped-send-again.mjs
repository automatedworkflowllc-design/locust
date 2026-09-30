// A run stopped before any tool ran offers Send again (0.479, QA-2026-09-29 round 2, R29),
// and the message sent again is drawn once (0.496).
//
//   node _tools/drive-stopped-send-again.mjs [--packaged <exe>]
//
// The card said "Stopped before it used any tools, so nothing is half-done"
// and offered nothing: the person retyped the message. This sends one on the
// free OpenCode model, presses Stop 900 ms in (past the 600 ms a double click
// is forgiven, before the model answers), then presses Send again and reads
// the reply that comes back. A run stopped after a tool ran must not offer it;
// that half is the render test's (an-ended-run-offers-the-way-on.test.tsx).

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await scratchRepository('locust-drive-send-again-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'stopped-send-again',
  port: 9651,
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

const threadText = `document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`
const waitIdle = `for (let i = 0; i < 720; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise((r) => setTimeout(r, 800))`

const sendThenStop = (text, stopAfterMs) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  let start
  for (let i = 0; i < 120 && !start; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Start mission"]')
    if (button && !button.disabled) start = button
  }
  if (!start) return JSON.stringify({ sent: false })
  start.click()
  await new Promise((r) => setTimeout(r, ${String(stopAfterMs)}))
  const stop = document.querySelector('button[aria-label^="Stop the running"]')
  stop?.click()
  ${waitIdle}
  const again = [...document.querySelectorAll('.lc-rerun button')].find((b) => /Send again/.test(b.innerText))
  return JSON.stringify({ sent: true, pressedStop: !!stop, offered: !!again, box: field.value, thread: ${threadText} })
})()`

const pressSendAgain = `(async () => {
  const again = [...document.querySelectorAll('.lc-rerun button')].find((b) => /Send again/.test(b.innerText))
  if (!again) return JSON.stringify({ pressed: false })
  again.click()
  await new Promise((r) => setTimeout(r, 1500))
  ${waitIdle}
  const still = [...document.querySelectorAll('.lc-rerun button')].some((b) => /Send again/.test(b.innerText))
  // The prompt carries the word too, so only a REPLY counts.
  const replies = [...document.querySelectorAll('.lc-agentline__body')].map((el) => el.innerText.trim())
  // 0.496: the message is drawn once, and no "fresh session" is claimed over a turn that said nothing.
  const bubbles = [...document.querySelectorAll('.lc-thread .lc-bubble')].filter((el) => /HERON/.test(el.innerText)).length
  const fresh = /A fresh session/.test(${threadText})
  return JSON.stringify({ pressed: true, stillOffered: still, reply: replies.at(-1) ?? '', replies: replies.length, bubbles, fresh })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  const stopped = JSON.parse(String(await drive.capture('stopped 900 ms in', () => drive.evaluate(sendThenStop('Reply with the single word HERON.', 900)))))
  check('the run was stopped before any tool ran', stopped.sent && stopped.pressedStop && /Stopped before it used any tools/.test(stopped.thread), stopped.thread.slice(-160))
  check('and the card offers Send again', stopped.offered)
  check('no reply had come back before the stop', !/HERON/i.test([...stopped.thread.matchAll(/HERON/gi)].length > 1 ? 'HERON' : ''), stopped.thread.slice(-160))
  check('the chat box is empty, as the defect found it', stopped.box === '', JSON.stringify(stopped.box))
  const again = JSON.parse(String(await drive.capture('Send again pressed', () => drive.evaluate(pressSendAgain))))
  check('Send again sent the message and the reply came back', again.pressed && /HERON/i.test(again.reply ?? ""), JSON.stringify({ replies: again.replies, reply: (again.reply ?? "").slice(0, 80) }))
  check('and the offer is gone once the message went again', again.pressed && !again.stillOffered)
  check('the message is drawn once, not once per try (0.496)', again.bubbles === 1, String(again.bubbles))
  check('and no "fresh session" is claimed: nothing before it was lost (0.496)', again.fresh === false)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
