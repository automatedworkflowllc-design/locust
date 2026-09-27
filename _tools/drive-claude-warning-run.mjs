// A Claude run survives its account's usage WARNING (0.413).
//
//   LOCUST_SPEND=1 node _tools/drive-claude-warning-run.mjs [--packaged <exe>] [--tag <name>]
//
// Colin's Drop, 2026-09-27: "Stopped -- the mission ledger could not be
// written: Mission event sequence is invalid", six seconds in. 0.407 made a
// usage WARNING emit a reading beside its notice, in the wrong order: N+1
// then N, which the ledger refuses. It fires only while the account is past a
// warning line -- which Colin's is (79% of the 7-day window) -- so this is one
// short Haiku turn on his account, the smallest real thing that reproduces it.
// Spends one Haiku turn.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('claude-warning-run-2026-09-27'), `claude-warning-run-${tag}`)
await mkdir(OUT, { recursive: true })
const drive = await startDrive({
  name: `claude-warning-${tag}`, port: 9735, workspace: await scratchRepository('locust-claude-warning-ws-'), outPath: OUT, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_drop', name: 'Drop', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-09-27T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Drop')}?.click()`)
  await sleep(600)
  const ended = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word: ready. Do not use any tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 300; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
    }
    return 'timed out'
  })()`))
  await sleep(1500)
  const thread = String(await drive.capture('the turn, ended', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`)))
  const header = String(await drive.evaluate(`document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  check('the turn ended', ended === 'ended', ended)
  check('it was not stopped for the ledger', !/ledger could not be written|sequence is invalid/i.test(thread), thread.slice(0, 200))
  check('it did not fail, and answered', !/failed/i.test(header) && /ready/i.test(thread), `${header.slice(0, 100)} || ${thread.slice(-80)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Drop on Claude Haiku, in Ask, on an account past a usage warning line.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
