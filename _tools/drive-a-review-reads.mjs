// "Ask <reviewer> for a review" runs read-only, and leaves the reviewer as they were (0.514).
//
//   node _tools/drive-a-review-reads.mjs [--packaged <exe>] [--tag <name>]
//
// Two long passes (0.509, 0.512) found the review running in the reviewer's
// saved Edit mode. Ash (free, Edit) makes a file; Bo (free, Edit) is asked
// for a review from the conversation's More actions. The review's run must be
// Ask; Bo's saved mode must still be Edit afterwards; the file must be as Ash
// left it. Spends nothing.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-review-reads-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-review-reads-${tag}`,
  port: 9821,
  workspace,
  outPath: join(recordRoot('a-review-reads-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE },
      { teammateId: 'tm_bo', name: 'Bo', hue: 'teal', role: 'Custom', roleTitle: 'Reviewer', createdAt: '2026-09-05T05:01:00.000Z', route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.capture('Ash makes a file', () => drive.evaluate(sendAndWaitScript('Create a file named hello.txt whose entire content is the single line HELLO. Do nothing else.')))
  const made = (await readFile(join(workspace, 'hello.txt'), 'utf8').catch(() => '')).trim()
  check('Ash made hello.txt', made === 'HELLO', made)
  const asked = String(await drive.capture('Ask Bo for a review', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="More actions"]')?.click()
    await new Promise((r) => setTimeout(r, 500))
    const item = [...document.querySelectorAll('button, [role="menuitem"]')].find((el) => el.innerText.trim() === 'Ask Bo for a review')
    if (!item) return 'no review item'
    item.click()
    await new Promise((r) => setTimeout(r, 3000))
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'asked'
  })()`)))
  check('the review was asked for from More actions', asked === 'asked', asked)
  // The review's own record: its mode, as the host started it.
  const ledgers = await readdir(join(drive.profile, 'mission-ledger')).catch(() => [])
  let reviewMode = 'not found'
  for (const name of ledgers) {
    const text = await readFile(join(drive.profile, 'mission-ledger', name), 'utf8').catch(() => '')
    // The review's brief, by its own heading; the ledger names no teammate (ownership is kept apart).
    if (!text.includes('WHAT WAS ASKED FOR')) continue
    const mode = /"mode":"([a-z-]+)"/.exec(text)?.[1]
    if (mode !== undefined) reviewMode = mode
  }
  check('Bo\'s review ran in Ask', reviewMode === 'ask', reviewMode)
  const roster = JSON.parse(await readFile(join(drive.profile, 'teammates.json'), 'utf8').catch(() => '{}'))
  const bo = (roster.teammates ?? []).find((entry) => entry.teammateId === 'tm_bo')
  check('and Bo is still in Edit afterwards: the review\'s Ask was for that run', bo?.route?.mode === 'accept-edits', JSON.stringify(bo?.route))
  check('the file is as Ash left it', (await readFile(join(workspace, 'hello.txt'), 'utf8').catch(() => '')).trim() === 'HELLO')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash and Bo, both free, both Edit.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
