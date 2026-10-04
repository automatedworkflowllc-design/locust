// "Install Node.js" is not said to a person who has it (0.412).
//
//   node _tools/drive-node-notice.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-27, a screenshot of Home: "Agents installed from here work
// inside Locust. To use one in your own terminal too, install Node.js" --
// "got this popup even though i have everything". Locust decided npm was
// absent from `npm --version` against a five-second clock, run in the launch
// moment beside every runtime probe; one slow answer stood for the session.
//
// A SEAM, said plainly: this launch's PATH starts with a folder holding an
// npm.cmd that takes eight seconds to answer -- a slow npm, on the PATH, as
// his was at that moment. Sends nothing.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('node-notice-2026-09-27'), `node-notice-${tag}`)
await mkdir(OUT, { recursive: true })
const slow = await mkdtemp(join(tmpdir(), 'locust-slow-npm-'))
await writeFile(join(slow, 'npm.cmd'), '@echo off\r\nping -n 9 127.0.0.1 >nul\r\necho 11.18.0\r\n', 'utf8')
const drive = await startDrive({
  name: `node-notice-${tag}`, port: 9733, workspace: await scratchRepository('locust-node-notice-ws-'), outPath: OUT, sendsNothing: true,
  env: { PATH: `${slow};${process.env.PATH ?? ''}` },
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-27T05:00:00.000Z', route: FREE_ROUTE }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.ready()
  await drive.resize(1440, 900)
  // Past the five-second clock and discovery's answer.
  await sleep(14_000)
  const home = String(await drive.capture('Home, with a slow npm on the PATH', () => drive.evaluate(`JSON.stringify({ note: document.querySelector('.lc-installnote')?.innerText.replace(/\\s+/g, ' ') ?? '', agents: document.querySelector('.lc-agenthead')?.innerText.replace(/\\s+/g, ' ') ?? '' })`)))
  const seen = JSON.parse(home)
  check('Home has its agents line', /AI agents/i.test(seen.agents), seen.agents.slice(0, 80))
  check('and does not tell a person with npm on their PATH to install Node.js', !/install\s*Node\.js/i.test(seen.note), seen.note || '(no note)')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. PATH led by an npm.cmd that answers after 8s (a slow npm, on the PATH).`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
