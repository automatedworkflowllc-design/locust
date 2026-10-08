// Cloud, with a Codex model picked, says Codex Cloud picks its own model (10/08).
//
//   node _tools/drive-codex-cloud-choice.mjs [--packaged <exe>] [--tag <name>]
//
// `codex cloud exec` (0.161.0) takes no model, so a Codex Cloud task runs on the
// model Codex Cloud chooses whatever the box shows. The chat-type menu's Cloud,
// on a Codex teammate, says so -- whole, not cut off. Sends nothing.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-codex-cloud-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `codex-cloud-choice-${tag}`,
  port: 9884,
  workspace,
  sendsNothing: true,
  outPath: join(recordRoot('codex-cloud-choice-2026-10-08'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_cole', name: 'Cole', hue: 'teal', role: 'Custom', roleTitle: 'Code', createdAt: '2026-10-08T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(`(async () => {
    const cole = [...document.querySelectorAll('button')].find((b) => /Cole/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    cole?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 1
  })()`)
  await drive.waitFor(`!!document.querySelector('.lc-control--chatmode')`, { timeoutMs: 60_000, what: 'the chat-type chip' })
  const read = JSON.parse(String(await drive.capture('the chat-type menu on a Codex teammate', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 500))
    const item = [...document.querySelectorAll('.lc-menu__item')].find((b) => /^Cloud/.test(b.innerText.trim()))
    const desc = item?.querySelector('.lc-menu__desc')
    const menu = item?.closest('[role=menu], .lc-menu')
    return JSON.stringify({
      text: item?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      // Whole: the description's natural size within the size it is given, and inside the menu.
      fits: desc ? desc.scrollWidth <= desc.clientWidth + 1 && desc.scrollHeight <= desc.clientHeight + 1 : false,
      inside: desc && menu ? desc.getBoundingClientRect().right <= menu.getBoundingClientRect().right + 1 : false
    })
  })()`))))
  check('Cloud says it runs on the model Codex Cloud chooses', /Cloud Runs in Codex Cloud on this repository, on the model Codex Cloud chooses; bring the change home when it is done/.test(read.text) || /pick one of their models first|not installed or not signed in/.test(read.text), read.text)
  check('the line is whole: not cut off, inside the menu', read.fits && read.inside, JSON.stringify(read))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Cole on a Codex model; the chat-type menu opened; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
