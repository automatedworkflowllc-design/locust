// Stop and send now (0.485): Claude Code's ctrl+enter.
//
//   node _tools/drive-stop-and-send-now.mjs [--packaged <exe>]
//
// A free-model run is given a long job; a second message is typed and
// queued; "Stop and send now" is pressed. The run must stop, and the queued
// message must go at once, into the same conversation, and be answered.
// Then the same with Ctrl+Enter on a freshly typed message. Free models only.

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await scratchRepository('locust-drive-send-now-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'stop-and-send-now',
  port: 9763,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const type = (text) => `(() => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
  return true
})()`
const running = `!!document.querySelector('button[aria-label^="Stop the running"]')`
const state = `JSON.stringify({
  running: !!document.querySelector('button[aria-label^="Stop the running"]'),
  queued: document.querySelector('.lc-queued__text')?.innerText ?? null,
  now: [...document.querySelectorAll('.lc-queued__action')].map((b) => b.innerText.trim()),
  stopped: /This run was stopped|You stopped this run/.test(document.querySelector('.lc-thread')?.innerText ?? ''),
  replies: [...document.querySelectorAll('.lc-agentline__body')].map((el) => el.innerText.trim())
})`
const waitFor = async (test, ms) => {
  for (let waited = 0; waited < ms; waited += 500) {
    if (await drive.evaluate(test)) return true
    await sleep(500)
  }
  return false
}
const enter = async (ctrl) => {
  const modifiers = ctrl ? 2 : 0
  await drive.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers, text: '\r' })
  await drive.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers })
}
const longJob = 'Count slowly from 1 to 300, one number per line, and say nothing else.'

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))

  // ---- The button. ----
  await drive.evaluate(type(longJob))
  await enter(false)
  check('the long job is running', await waitFor(running, 60_000))
  await sleep(2500)
  await drive.evaluate(type('Stop counting. Reply with the single word OSPREY.'))
  await enter(false)
  await sleep(800)
  const queued = JSON.parse(String(await drive.capture('a message queued behind the run', () => drive.evaluate(state))))
  check('the message is queued, with Stop and send now beside it', queued.queued !== null && queued.now.includes('Stop and send now'), JSON.stringify({ queued: queued.queued, now: queued.now }))
  await drive.evaluate(`[...document.querySelectorAll('.lc-queued__action')].find((b) => b.innerText.trim() === 'Stop and send now')?.click()`)
  await waitFor(`!document.querySelector('.lc-queued__text') && /OSPREY/i.test([...document.querySelectorAll('.lc-agentline__body')].map((el) => el.innerText).join(' '))`, 120_000)
  await waitFor(`!(${running})`, 60_000)
  const after = JSON.parse(String(await drive.capture('stopped, and the queued message answered', () => drive.evaluate(state))))
  // A stopped card is drawn on the latest turn only; the stopped turn is now an
  // earlier one, so what shows it was cut short is that it has no reply.
  check('the long job was cut short: it never answered, the queued message did', after.replies.length === 1, JSON.stringify(after.replies.map((r) => r.slice(0, 30))))
  check('the queued message went at once and was answered, in this conversation', after.queued === null && /OSPREY/i.test(after.replies.at(-1) ?? ''), JSON.stringify(after.replies.at(-1)?.slice(0, 80)))

  // ---- Ctrl+Enter. ----
  await drive.evaluate(type(longJob))
  await enter(false)
  check('a second long job is running', await waitFor(running, 60_000))
  await sleep(2500)
  await drive.evaluate(type('Stop counting. Reply with the single word HERON.'))
  await enter(true)
  await waitFor(`!document.querySelector('.lc-queued__text') && /HERON/i.test([...document.querySelectorAll('.lc-agentline__body')].map((el) => el.innerText).join(' '))`, 120_000)
  await waitFor(`!(${running})`, 60_000)
  const keyed = JSON.parse(String(await drive.capture('Ctrl+Enter: stopped, and answered', () => drive.evaluate(state))))
  check('Ctrl+Enter stopped the run and sent the message at once', keyed.queued === null && keyed.replies.length === 2 && /HERON/i.test(keyed.replies.at(-1) ?? ''), JSON.stringify(keyed.replies.map((r) => r.slice(0, 30))))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
