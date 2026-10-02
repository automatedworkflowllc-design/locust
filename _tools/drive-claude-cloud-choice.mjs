// Cloud, with a Claude model picked, offers Claude's cloud (0.538).
//
//   node _tools/drive-claude-cloud-choice.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-02: "just implement the claude cloud as best as possible but
// also make it easy and seamless for the user". The chat-type menu's Cloud,
// on a Claude teammate: its description says Claude's cloud, the box asks for
// a task for Claude's cloud, and the panel beside says what happens and none
// of Codex Cloud's warnings. Sends nothing: a send opens Claude Code itself.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-claude-cloud-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `claude-cloud-choice-${tag}`,
  port: 9860,
  workspace,
  sendsNothing: true,
  outPath: join(recordRoot('claude-cloud-choice-2026-10-02'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_clay', name: 'Clay', hue: 'violet', role: 'Custom', roleTitle: 'Code', createdAt: '2026-10-02T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }],
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
    const clay = [...document.querySelectorAll('button')].find((b) => /Clay/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    clay?.click()
    await new Promise((r) => setTimeout(r, 900))
    return 1
  })()`)
  // The chip is drawn once the runtimes on the machine are known.
  await drive.waitFor(`!!document.querySelector('.lc-control--chatmode')`, { timeoutMs: 60_000, what: 'the chat-type chip' })
  const menu = String(await drive.capture('the chat-type menu', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return [...document.querySelectorAll('.lc-menu__item')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')
  })()`)))
  check('Cloud is offered, described as Claude’s cloud', /Cloud Runs in Claude’s cloud, in a Claude Code window of its own/.test(menu) && !/pick one of their models first/.test(menu), menu)
  const chosen = String(await drive.capture('Cloud chosen', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-menu__item')].find((b) => /^Cloud/.test(b.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 900))
    return JSON.stringify({
      placeholder: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? '',
      panel: document.querySelector('.lc-cloudtasks')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    })
  })()`)))
  const got = JSON.parse(chosen)
  check('the box asks for a task for Claude’s cloud', got.placeholder === 'Describe a task for Claude’s cloud…', got.placeholder)
  check('the panel is Claude’s cloud and says what happens, the trust question included', /Claude’s cloud/.test(got.panel) && /Claude Code opens in a window of its own with the task given/.test(got.panel) && /asks whether you trust it: answer in that window/.test(got.panel), got.panel)
  check('none of Codex Cloud’s warnings', !/Codex Cloud|not on GitHub|Legacy/.test(got.panel), got.panel)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Clay on Claude Haiku; Cloud chosen; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
