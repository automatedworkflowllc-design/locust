// A long conversation moves to another model without losing its end (0.513).
//
//   LOCUST_SPEND=1 node _tools/drive-a-long-conversation-changes-model.mjs [--packaged <exe>] [--tag <name>]
//
// Before 0.513 a task too long for the hand-off brief was clipped (beside a
// reply) or refused (without one) -- for the conversation most likely to have
// hit a limit. Ash, on a free OpenCode model, is sent a first message of
// about 7,800 characters whose LAST line holds a code word. Then Ash is moved
// to Codex and asked for that code word. Clipped, the end is gone and Codex
// cannot know it; carried by file, it reads it. Spends one Codex turn.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, git, openTeammateScript, pickRouteScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-long-switch-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `long-conversation-changes-model-${tag}`,
  port: 9817,
  workspace,
  spends: true,
  outPath: join(recordRoot('a-long-conversation-changes-model-2026-10-01'), tag),
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
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}

// Background a person might paste: long, plain, and nothing to act on. The code word is only at the end.
const PARAGRAPH = 'Background for later: the team keeps its notes in plain text, reviews them on Fridays, and prefers short sentences over long ones. Nothing here needs doing now. '
const FIRST = `${PARAGRAPH.repeat(49)}\n\nLast line: the code word is ZEBRA-4417. For now, reply with just OK and do not touch any file.`

try {
  check('the first message is long, and under the composer\'s limit', FIRST.length > 7_850 && FIRST.length < 8_000, FIRST.length)
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.capture('the long first message, on the free model', () => drive.evaluate(sendAndWaitScript(FIRST)))
  const moved = String(await drive.evaluate(pickRouteScript({ group: '/codex/i', search: 'astra', row: '/astra/i' })))
  const onCodex = /Codex/.test(moved) && !/no matching route/.test(moved)
  check('Ash is moved to Codex', onCodex, moved)
  // On the same runtime the session simply resumes, and the check below would pass for the wrong reason.
  if (!onCodex) throw new Error('not moved to another runtime, so nothing below would test a hand-off')
  await drive.capture('asked on Codex for the code word', () => drive.evaluate(sendAndWaitScript('What is the code word in the last line of my first message? Reply with just the code word.')))
  const thread = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  const failed = String(await drive.evaluate(`document.querySelector('.lc-card.is-red')?.innerText.replace(/\\s+/g, ' ') ?? ''`))
  check('the switch was not refused', !/too long to carry/.test(thread) && failed.length === 0, failed || 'no failure card')
  const answer = thread.slice(thread.lastIndexOf('Reply with just the code word.'))
  check('Codex knows the code word from the end of the long message', /ZEBRA-4417/.test(answer), answer.slice(-200))
  const handed = await readdir(join(workspace, '.locust', 'attachments')).catch(() => [])
  check('the whole message was handed over as a file in .locust/attachments', handed.some((name) => /^conversation-mission_.*\.md$/.test(name)), JSON.stringify(handed))
  const status = await git(['status', '--porcelain'], workspace).catch((error) => `git failed: ${String(error)}`)
  check('and git does not see it', !/\.locust/.test(String(status)), String(status) || 'clean')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash: free OpenCode, then Codex.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
