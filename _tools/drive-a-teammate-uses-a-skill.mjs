// A Claude Code teammate uses the folder's skill (0.679).
//
//   LOCUST_SPEND=1 node _tools/drive-a-teammate-uses-a-skill.mjs [--packaged <exe>] [--tag <name>] [--auto]
//
// Every Claude run outside Auto is `--restricted`, which drops the folder's
// .claude/skills (measured 2026-10-04, FINDING-claude-skills-under-restricted),
// and `Skill` was not on Locust's tool list at all. 0.679 adds the tool and
// hands the folder's skills over as a plugin copied for the run. A scratch
// project holds one skill, `locust-probe`, whose SKILL.md asks for a made-up
// word and a second word kept in a file beside it. A teammate on Claude Haiku
// in Ask -- the strictest mode -- is asked to use the skill: the reply must
// carry both words (the skill loaded, and its own file could be read), the
// thread must say "Used the locust-probe skill", the run's copy must be gone
// afterwards, and the folder must be as it was. 0.678 fails the first three.
// `--auto` runs the same in Auto, where Claude Code runs as the person and
// finds the folder's skills itself, with no copy. Spends one Haiku turn.

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openAllStepsScript, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const auto = process.argv.includes('--auto')
const tag = arg('--tag') ?? (auto ? 'auto' : 'local')
const workspace = await scratchRepository('locust-drive-skill-ws-')
const skillDir = join(workspace, '.claude', 'skills', 'locust-probe')
await mkdir(skillDir, { recursive: true })
await writeFile(join(skillDir, 'SKILL.md'), [
  '---',
  'name: locust-probe',
  'description: A probe skill that answers with two made-up words. Use when asked to use the locust-probe skill.',
  '---',
  '',
  'When this skill is used:',
  '1. Read the file second-word.md in this skill\'s own folder (the folder this SKILL.md is in).',
  '2. Reply with exactly two words: ZORBLEQUIN, then the word written in second-word.md. Say nothing else.',
  ''
].join('\n'), 'utf8')
await writeFile(join(skillDir, 'second-word.md'), 'MARVELLITH\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'a skill'], workspace)

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-teammate-uses-a-skill-${tag}`, port: 9803, workspace, spends: true, keep: process.env.LOCUST_KEEP === '1',
  outPath: join(recordRoot('a-teammate-uses-a-skill-2026-10-06'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: auto ? 'auto' : 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: auto }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 860)
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  const sent = String(await drive.capture('Ash uses the skill', () => drive.evaluate(sendAndWaitScript('Use the locust-probe skill and reply with what it tells you to say.', { waitSeconds: 300 }))))
  say(`  sent: ${sent.slice(0, 160)}`)
  await sleep(1500)
  const reply = String(await drive.evaluate(`(() => [...document.querySelectorAll('.lc-thread .lc-agentline__body')].at(-1)?.innerText ?? '')()`))
  say(`  reply: ${reply.slice(0, 200)}`)
  check('the skill loaded: the reply has its word', /ZORBLEQUIN/.test(reply), reply)
  check("the skill's own file could be read: the reply has the second word", /MARVELLITH/.test(reply), reply)
  await drive.evaluate(openAllStepsScript())
  const thread = String(await drive.capture('the steps, open', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`)))
  check('the thread says which skill was used', /Used the locust-probe skill/.test(thread), thread.slice(-400))
  check('no row shows the tool id or the prefix Locust added', !/project:locust-probe|\bSkill\b(?! )/.test(thread), thread.slice(-400))
  // The run's copy is removed when its process ends.
  await sleep(1000)
  const copies = await readdir(join(drive.profile, 'claude-skills')).catch(() => [])
  check("the run's copy of the skill is gone", copies.length === 0, JSON.stringify(copies))
  const status = await git(['status', '--porcelain'], workspace)
  check(`${auto ? 'Auto' : 'Ask'} changed nothing in the folder`, String(status).trim() === '', String(status))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, ${auto ? 'Auto' : 'Ask'}: a folder's skill, used.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
