// Cloud where the repository has no Codex Cloud environment: said before a send (0.505).
//
//   node _tools/drive-cloud-without-an-environment.mjs --repo <a clone whose repo HAS an environment> [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30: his Sol brief went to Codex Cloud from his Locust folder
// (Cloud had stayed picked) and came back refused -- the repository was on
// GitHub but had no environment. Here the window's folder points at a GitHub
// repository with no environment; Locust knows a clone that has one. Picking
// Cloud must say so before anything is sent and offer the clone; switching
// teammate must put the box back to Direct. Sends nothing to any cloud.

import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openTeammateScript, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const repo = arg('--repo')
if (repo === undefined) {
  say('usage: node _tools/drive-cloud-without-an-environment.mjs --repo <clone with an environment> [--packaged <exe>]')
  process.exit(2)
}
const workspace = await scratchRepository('locust-drive-no-env-ws-')
// On GitHub by its remote, with no Codex Cloud environment. Nothing is ever pushed.
execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/automatedworkflowllc-design/ai-teammate-platform.git'], { cwd: workspace })
const profile = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-no-env-profile-'))
await writeFile(join(profile, 'folders.json'), JSON.stringify({ folders: [{ id: 'ws_drive_clone', path: resolve(repo) }] }), 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `cloud-no-env-${tag}`,
  port: 9811,
  workspace,
  profilePath: profile,
  sendsNothing: true,
  outPath: join(recordRoot('cloud-task-2026-09-30'), `no-env-${tag}`),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_coda', name: 'Coda', hue: 'teal', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' } },
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' } }
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
const panel = `JSON.stringify({
  head: document.querySelector('.lc-cloudtasks .lc-beside__title')?.innerText.trim() ?? null,
  elsewhere: document.querySelector('.lc-cloudtasks__elsewhere')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
  folders: [...document.querySelectorAll('.lc-cloudtasks__folders li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()),
  chip: document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? null
})`
const pickCloud = `(async () => {
  document.querySelector('.lc-control--chatmode')?.click()
  await new Promise((r) => setTimeout(r, 400))
  ;[...document.querySelectorAll('.lc-menu [role="menuitemradio"]')].find((el) => /^Cloud/.test(el.innerText.trim()))?.click()
  for (let i = 0; i < 60 && !/environment/.test(document.querySelector('.lc-cloudtasks__elsewhere')?.innerText ?? ''); i += 1) await new Promise((r) => setTimeout(r, 500))
  // Each known folder is asked whether it has an environment: a few seconds.
  for (let i = 0; i < 90 && document.querySelectorAll('.lc-cloudtasks__folders li').length === 0; i += 1) await new Promise((r) => setTimeout(r, 500))
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Coda'))
  await drive.evaluate(pickCloud)
  const here = JSON.parse(String(await drive.capture('Cloud picked on a repository with no environment', () => drive.evaluate(panel))))
  check('the panel says this repository has no environment, before any send', /ai-teammate-platform has no Codex Cloud environment yet/.test(here.elsewhere ?? ''), here.elsewhere)
  check('and says how to make one', /Legacy Codex Cloud/.test(here.elsewhere ?? ''), here.elsewhere)
  check('and offers the folder that has one', here.folders.some((row) => /locust-cloud-test/.test(row) && /Open/.test(row)), JSON.stringify(here.folders))

  await drive.evaluate(openTeammateScript('Ash'))
  await new Promise((r) => setTimeout(r, 800))
  const other = JSON.parse(String(await drive.evaluate(panel)))
  check('another teammate: the box is back to Direct', /Direct/.test(other.chip ?? ''), other.chip)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A folder on GitHub without a Codex Cloud environment.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
