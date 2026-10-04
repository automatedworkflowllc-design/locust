// Does a send refused as busy say why (M27)?
//
//   LOCUST_SPEND=1 node _tools/drive-busy-says-why.mjs [--packaged <exe>] [--tag <name>]
//
// The code review's M27: with no teammates, every conversation is nobody's,
// and the host runs one of those at a time. A second task sent while the
// first runs came back into the box with no word at all. The first task
// runs on Claude Haiku (a slow count); from Home, a second is sent. It must
// come back into the box WITH the host's reason beside it. One Haiku turn.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `busy-says-why-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const drive = await startDrive({
  spends: true,
  name: 'busy-says-why',
  port: 9563,
  workspace: await scratchRepository('locust-drive-busy-ws-'),
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const send = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  if (!field) return 'no box'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 80; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const button = document.querySelector('button[aria-label="Send"]')
    if (button && !button.disabled) { button.click(); return 'sent' }
  }
  return 'no send'
})()`

try {
  await drive.capture('launch: no teammates', () => drive.ready())
  await drive.resize(1215, 800)
  const route = await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  say(`route: ${String(route)}`)
  // Ask mode, so the first run touches nothing.
  const first = await drive.capture('the first task, a slow one', () => drive.evaluate(send('Count from 1 to 60, one number per line, slowly. Do not use any tools.')))
  check('the first task was sent', first === 'sent', String(first))
  await drive.evaluate(`(async () => {
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) return 'running'
    }
    return 'not running'
  })()`)
  await drive.evaluate(`document.querySelector('button[aria-label="Home"]')?.click()`)
  await sleep(800)
  const second = await drive.capture('from Home, a second task while the first runs', () => drive.evaluate(send('SECOND TASK: say hello.')))
  check('the second task was sent', second === 'sent', String(second))
  await sleep(3000)
  const after = JSON.parse(String(await drive.evaluate(`JSON.stringify({
    box: document.querySelector('form.command-dock textarea')?.value ?? null,
    notice: document.querySelector('form.command-dock .lc-notice, .lc-notice')?.textContent?.trim() ?? null
  })`)))
  await drive.capture('what the box says', () => drive.evaluate(`JSON.stringify(${JSON.stringify(after)})`))
  check('its words come back into the box', after.box === 'SECOND TASK: say hello.', String(after.box))
  check('and the box says why', typeof after.notice === 'string' && /^Not sent:/.test(after.notice), String(after.notice))
  // Stop the first run; nothing else needs it.
  await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]')?.click()`)
  await sleep(1500)
  say(failures === 0 ? '\nBUSY SAYS WHY PASSED' : `\nBUSY SAYS WHY: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. No teammates; a slow Haiku task running, then a second task sent from Home.` })
}
