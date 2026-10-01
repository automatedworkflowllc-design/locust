// Does a message that says its recipient need do nothing start nothing (A2.3)?
//
//   LOCUST_SPEND=1 node _tools/drive-closing-message.mjs [--request] [--packaged <exe>] [--tag <name>]
//
// Wren, on Claude Haiku with replies on, is asked to send Booty one message:
// "The deploy finished. No further action is needed from you." The host
// should deliver it and start nothing -- the 0.312 relay drive spent a whole
// run of Booty's on exactly that sentence. --request sends a message that
// asks for something instead ("please check the logs"), which must still
// start Booty's run: the rule must not swallow a request. One Haiku turn, or
// two with --request.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace, teammateRows, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const REQUEST = process.argv.includes('--request')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `closing-message-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { runtime: 'claude', model: 'haiku', mode: 'ask' }
const SAYING = REQUEST
  ? 'The deploy finished. Please check the deploy log and tell me the first line of it.'
  : 'The deploy finished. No further action is needed from you.'
const drive = await startDrive({
  name: 'closing-message',
  port: 9539,
  workspace: await scratchRepository('locust-drive-closing-ws-'),
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 4, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const busy = `${teammateRows()}.some(r => /working|running|starting|replying|listening|thinking|waiting/i.test(r.innerText))`

try {
  await drive.capture('launch: Wren and Booty on Claude Haiku, replies on', () => drive.ready())
  await drive.capture(`Wren is asked to send Booty: "${SAYING}"`, () => drive.evaluate(`(async () => {
    window.__updates = []
    window.desktop.onCodexMissionUpdate(u => { if (u.kind !== 'event') window.__updates.push({ kind: u.kind, message: u.message, teammateId: u.teammateId, startedBy: u.startedBy }) })
    const wren = ${teammateFace('Wren')}
    wren.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(`Send your teammate Booty one message with the share block, saying exactly: ${SAYING} Do nothing else.`)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  await drive.capture('wait for everything to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 600; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 40 && !document.querySelector('button[aria-label^="Stop the running"]') && !${busy}) return 'settled after ' + String(i / 2) + 's'
    }
    return 'still going'
  })()`))
  const updates = JSON.parse(String(await drive.evaluate(`JSON.stringify(window.__updates ?? [])`)))
  if (outPath !== undefined) await writeFile(join(outPath, 'host-updates.json'), JSON.stringify(updates, null, 2), 'utf8')
  const notices = updates.filter((u) => u.kind === 'relay-notice').map((u) => u.message)
  const bootyRuns = updates.filter((u) => u.kind === 'mission-started' && u.teammateId === 'tm_booty')
  const thread = String(await drive.capture("Wren's thread", () => drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 600)`)))
  say(`notices: ${notices.join(' / ') || '(none)'} || Booty runs started: ${String(bootyRuns.length)}`)
  check('the message reached Booty', /1 message to\s*Booty/i.test(thread), thread.slice(0, 200))
  if (REQUEST) {
    // At least one: the first --request run went on to a second of Booty's,
    // rightly -- Booty asked Wren where the log was, Wren answered in its own
    // conversation, and A2.1 brought the answer back to Booty.
    check('a message that asks for something still starts Booty', bootyRuns.length >= 1, String(bootyRuns.length))
  } else {
    check('a message saying nothing is needed starts nothing', bootyRuns.length === 0, String(bootyRuns.length))
    check('and the thread says why', notices.includes('Sent to Booty to read on their next run: the message says nothing more is needed from them.'), notices.join(' / '))
  }
  say(failures === 0 ? '\nCLOSING MESSAGE PASSED' : `\nCLOSING MESSAGE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Booty on Claude Haiku (Ask), replies on, budget 4. Wren sends Booty: "${SAYING}"` })
}
