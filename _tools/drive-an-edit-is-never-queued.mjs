// An edited message is never queued behind a run in another conversation (0.500).
//
//   node _tools/drive-an-edit-is-never-queued.mjs [--packaged <exe>] [--tag <name>]
//
// 0.499's rewind went through the ordinary start, and a teammate busy
// elsewhere turns a start into a queued message -- which the queue sends as a
// plain reply at the END of the conversation, not where it was edited. Ash
// answers once; their first message is edited into a long shell count, which
// starts a second conversation and keeps them busy; back on the first, an
// edit is sent. It must come back with the reason, its words still in the
// box, and nothing queued. Spends nothing.

import { join } from 'node:path'
import { FREE_ROUTE, conversationRows, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-edit-queue-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `an-edit-is-never-queued-${tag}`,
  port: 9801,
  workspace,
  outPath: join(recordRoot('edit-an-earlier-message-2026-09-30'), `never-queued-${tag}`),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 220)}`}`)
}
const editAndSend = (words, text) => `(async () => {
  const bubble = [...document.querySelectorAll('.lc-thread .lc-bubble')].find((el) => el.innerText.includes(${JSON.stringify(words)}))
  const edit = bubble?.querySelector('.lc-bubble__edit')
  if (!edit) return JSON.stringify({ pressed: false })
  edit.click()
  await new Promise((r) => setTimeout(r, 600))
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  // Enter, as a person sends: the form is submitted whatever the button shows.
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 3000))
  return JSON.stringify({
    pressed: true,
    box: field.value,
    banner: document.querySelector('.lc-queued.is-editing')?.innerText.trim() ?? null,
    notice: [...document.querySelectorAll('form.command-dock .lc-notice, .lc-notice')].map((el) => el.innerText.trim()).join(' / '),
    queued: document.querySelectorAll('.lc-queued:not(.is-editing)').length,
    running: !!document.querySelector('button[aria-label^="Stop the running"]')
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.evaluate(sendAndWaitScript('Reply with the single word HERON.'))
  // The first message edited into a long count: a second conversation, and Ash busy with it.
  const long = JSON.parse(String(await drive.evaluate(editAndSend('HERON', 'Using the shell, run a command that prints the numbers 1 to 300, one per second. Then say DONE.'))))
  check('the long count started in a new conversation', long.pressed && long.running, JSON.stringify(long))
  await sleep(4000)
  // Back to the first conversation, which is finished.
  const opened = String(await drive.evaluate(`(async () => {
    const rows = ${conversationRows()}
    const first = rows.find((row) => /HERON/.test(row.title) && !row.running)
    if (!first) return 'no row: ' + rows.map((row) => row.title).join(' | ')
    first.click()
    await new Promise((r) => setTimeout(r, 1500))
    return 'opened'
  })()`))
  check('the first conversation opens while Ash works on the other', opened === 'opened', opened)
  const edited = JSON.parse(String(await drive.capture('an edit sent while Ash is busy elsewhere', () => drive.evaluate(editAndSend('HERON', 'Reply with the single word OTTER.')))))
  check('the edit is not queued', edited.queued === 0, JSON.stringify(edited))
  check('it says why it was not sent', /still working/.test(edited.notice), edited.notice)
  check('and its words are still in the box, still an edit', /OTTER/.test(edited.box) && /Editing an earlier message/.test(edited.banner ?? ''), JSON.stringify({ box: edited.box, banner: edited.banner }))
  // Let the other run go.
  await drive.evaluate(`(async () => {
    const rows = ${conversationRows()}
    rows.find((row) => /1 to 300/.test(row.title))?.click()
    await new Promise((r) => setTimeout(r, 1200))
    document.querySelector('button[aria-label^="Stop the running"]')?.click()
    await new Promise((r) => setTimeout(r, 3000))
  })()`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on the free OpenCode model.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
