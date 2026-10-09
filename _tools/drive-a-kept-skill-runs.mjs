// A skill kept from GitHub is called by a real Claude Code run, in Ask and in Auto (0.710).
//
//   LOCUST_SPEND=1 node _tools/drive-a-kept-skill-runs.mjs [--packaged <exe>] [--mode ask|auto]
//
// The profile is seeded with a kept skill exactly as Settings > Skills from GitHub leaves one
// (`skill-library/skills/<name>/SKILL.md` + `library.json`), so this reads nothing from GitHub. Its whole
// instruction is to answer with a word nobody would guess. A teammate on Claude Haiku is asked to use it; the
// run must call `library:<name>` (from the record) and the reply must carry the word. Auto is the case 0.710
// changed: Auto used to be given no plugin at all, and the kept skills live where only Locust looks.
//
// Spends: one short Haiku turn on Colin's Claude account (the cheapest model that answers).
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const mode = arg('--mode') ?? 'ask'
if (mode !== 'ask' && mode !== 'auto') throw new Error('--mode is ask or auto')
const SKILL = 'locust-kept-probe'
const WORD = 'MARIGOLD-7319'

const profile = await mkdtemp(join(tmpdir(), `locust-drive-kept-skill-${mode}-`))
await mkdir(join(profile, 'skill-library', 'skills', SKILL), { recursive: true })
await writeFile(join(profile, 'skill-library', 'skills', SKILL, 'SKILL.md'), `---
name: ${SKILL}
description: Answers a kept-skill probe. Use when asked to use the ${SKILL} skill.
---

Reply with exactly this word and nothing else: ${WORD}
`, 'utf8')
await writeFile(join(profile, 'skill-library', 'library.json'), JSON.stringify({
  version: 1,
  sources: [{ source: 'locust-test/kept-probe', ref: 'main', sha: '0'.repeat(40), keptAt: '2026-10-09T00:00:00.000Z', skills: [{ name: SKILL, files: 1, bytes: 160, runs: [] }] }]
}), 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-kept-skill-runs-${mode}`, port: 9874, workspace: await scratchRepository('locust-drive-kept-skill-ws-'), profilePath: profile, spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: mode === 'auto', claudeOwnSkills: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  say(`  ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
  await drive.capture(`Ash, in ${mode}, uses the kept skill`, () => drive.evaluate(sendAndWaitScript(`Use the ${SKILL} skill and do exactly what it says.`, { waitSeconds: 240 })))
  await sleep(1500)
  const reply = String(await drive.evaluate(`(() => [...document.querySelectorAll('.lc-thread .lc-agentline__body')].at(-1)?.innerText ?? '')()`))
  say(`  reply: ${reply.replace(/\s+/g, ' ').slice(0, 300)}`)
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
  // The profile's notes name what each Claude run was handed (`skills-given`, locust-errors.log).
  const given = (await readFile(join(drive.profile, 'locust-errors.log'), 'utf8').catch(() => '')).split('\n').filter((line) => line.includes('skills-given')).at(-1) ?? ''
  check(`in ${mode}, the run was handed library:${SKILL}`, given.includes(`library:${SKILL}`), given.slice(-200) || '(no skills-given line)')
  check(`and called it`, called.includes(`library:${SKILL}`), JSON.stringify(called))
  check('the reply is what the skill says to answer', reply.includes(WORD), reply.slice(0, 200))
  // Nothing of the run's copy is left beside the kept skill.
  check('the kept skill is still kept after the run', (await readdir(join(profile, 'skill-library', 'skills'))).includes(SKILL))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Claude Haiku, ${mode}, one kept skill.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
