// A folder is one folder however it is spelled (0.480, QA-2026-09-29 round 2, N13).
//
//   node _tools/drive-one-folder-however-spelled.mjs [--packaged <exe>]
//
// The folder's id hashes its path as written, so opening the same project as
// `c:\...` after `C:\...`, or through a junction to it, made a second folder
// with none of the conversations. This launches three times on one profile:
// the folder as spelled, then in lower case, then through a junction, and
// reads the folder list each time. Windows only (a case-insensitive disk).
// Sends nothing.

import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await scratchRepository('locust-drive-spelled-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-spelled-profile-'))
const junction = join(tmpdir(), `locust-drive-spelled-link-${String(process.pid)}`)
await symlink(workspace, junction, 'junction')
const seed = { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const launch = async (spelled, step, last) => {
  const drive = await startDrive({
    ...(packaged === undefined ? {} : { packaged }),
    name: 'one-folder-however-spelled', port: 9757, workspace: spelled, profilePath, seed, launchElsewhere: true, sendsNothing: true, keep: true, stepFrom: step
  })
  try {
    await drive.capture(`launch with ${spelled}`, () => drive.ready())
    return JSON.parse(String(await drive.evaluate(`window.desktop.listFolders().then((listed) => JSON.stringify({ current: listed.currentId, folders: listed.folders.map((f) => ({ id: f.id, path: f.path })) }))`)))
  } finally {
    await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Launched on ${spelled}; nothing sent.`, extra: `Checks failed so far: ${String(failures)}`, last })
  }
}

try {
  const first = await launch(workspace, 0, false)
  check('the folder is known after the first launch', first.current !== undefined && first.folders.length === 1, JSON.stringify(first))
  const lower = await launch(workspace.toLowerCase(), 2, false)
  check('in lower case it is the same folder', lower.current === first.current, `${String(first.current)} vs ${String(lower.current)}`)
  check('and the list still holds one folder', lower.folders.length === 1, JSON.stringify(lower.folders))
  const linked = await launch(junction, 4, true)
  check('through a junction it is the same folder', linked.current === first.current, `${String(first.current)} vs ${String(linked.current)}`)
  check('and the list still holds one folder', linked.folders.length === 1, JSON.stringify(linked.folders))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await rm(junction, { force: true }).catch(() => undefined)
  await rm(profilePath, { recursive: true, force: true }).catch(() => undefined)
}
say(`Checks failed: ${String(failures)}`)
if (failures > 0) process.exitCode = 1
