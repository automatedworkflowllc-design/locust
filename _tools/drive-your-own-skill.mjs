// A teammate uses one of YOUR skills (0.679).
//
//   LOCUST_SPEND=1 node _tools/drive-your-own-skill.mjs [--packaged <exe>] [--skill shipcheck] [--off]
//
// Settings > Teammates > Your skills lends ~/.claude/skills to Claude Code teammates. With it on, a teammate on
// Claude Haiku in Ask is asked to run the person's own `shipcheck` (a gate: labels must match their values) on a
// scratch page whose headline says "$0 lost" above two losses. The run must call the skill by name, the thread
// must say "Used the shipcheck skill", and the reply must catch the contradiction. `--off` runs the same with the
// switch off: the skill is not there. Reads the skill folder's names only; Ask changes nothing. One Haiku turn.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openAllStepsScript, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const skill = arg('--skill') ?? 'shipcheck'
const lent = !process.argv.includes('--off')
const tag = `${packaged === undefined ? 'local' : 'packaged'}-${lent ? 'lent' : 'off'}`
const workspace = await scratchRepository('locust-drive-own-skill-ws-')
await writeFile(join(workspace, 'index.html'), `<!doctype html>
<h1>Job costing</h1>
<p class="headline">MONEY LOST ON OVER-BUDGET JOBS: $0</p>
<table>
  <tr><th>Job</th><th>Quoted</th><th>Actual</th><th>Status</th></tr>
  <tr><td>Kitchen</td><td>$2,000</td><td>$2,500</td><td>OVER BUDGET (-$500)</td></tr>
  <tr><td>Deck</td><td>$3,000</td><td>$3,600</td><td>OVER BUDGET (-$600)</td></tr>
</table>
`, 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `your-own-skill-${tag}`, port: 9805, workspace, spends: true,
  outPath: join(recordRoot('your-own-skill-2026-10-06'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, claudeOwnSkills: lent }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 860)
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  await drive.capture(`Ash runs ${skill}`, () => drive.evaluate(sendAndWaitScript(`Use my ${skill} skill on index.html and tell me its verdict in a few lines.`, { waitSeconds: 300 })))
  await sleep(1500)
  const reply = String(await drive.evaluate(`(() => [...document.querySelectorAll('.lc-thread .lc-agentline__body')].at(-1)?.innerText ?? '')()`))
  say(`  reply: ${reply.replace(/\s+/g, ' ').slice(0, 400)}`)
  // Which skill the run called, from the record.
  const called = []
  const ledger = join(drive.profile, 'mission-ledger')
  for (const file of (await readdir(ledger)).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(ledger, file), 'utf8')).split('\n')) {
      try {
        const event = JSON.parse(line).event
        if (event?.type === 'tool.started' && event.payload?.name === 'Skill') called.push(event.payload.command ?? '')
      } catch { /* a partial line */ }
    }
  }
  say(`  Skill calls: ${JSON.stringify(called)}`)
  await drive.evaluate(openAllStepsScript())
  const thread = String(await drive.capture('the steps, open', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`)))
  if (lent) {
    check(`the run called your ${skill} skill`, called.includes(`personal:${skill}`), JSON.stringify(called))
    check(`the thread says "Used the ${skill} skill"`, thread.includes(`Used the ${skill} skill`), thread.slice(-300))
    check('the reply catches the headline that contradicts the rows', /\$0|0 lost|contradict|mismatch|does not match|doesn't match|\$1,?100|wrong/i.test(reply), reply.slice(0, 300))
  } else {
    check(`with the switch off, your ${skill} skill is not there to call`, !called.includes(`personal:${skill}`), JSON.stringify(called))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, Ask, Your skills ${lent ? 'lent' : 'off'}: ${skill}.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
