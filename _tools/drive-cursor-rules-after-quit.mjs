// Connector rules a Cursor run left behind when Locust quit are taken back at the next start (0.588).
//
//   node _tools/drive-cursor-rules-after-quit.mjs [--packaged <exe>] [--tag <name>]
//
// 0.584 gave a Cursor run's `Mcp(server:*)` rules back when its process
// ended; a run live when Locust quit never did, and the next start saw rules
// it had not added and left them. This stands in for that earlier Locust: a
// workspace whose .cursor/cli.json holds the rule beside a rule the person
// wrote, and a profile whose cursor-connector-holds.json names the rule as
// held. The app launches, and the rule must be gone while the person's rule
// stays; a second workspace whose file the run CREATED must have the file
// and its folder gone. No model runs; this sends nothing and spends nothing.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const RULE = 'Mcp(robinhood-local:*)'

// Workspace A: the person's own file, with the run's rule added to it.
const workspace = await scratchRepository('locust-drive-rules-after-quit-ws-')
const fileA = join(workspace, '.cursor', 'cli.json')
await mkdir(join(workspace, '.cursor'), { recursive: true })
await writeFile(fileA, `${JSON.stringify({ version: 1, permissions: { allow: ['Shell(ls)', RULE], deny: ['Shell(rm)'] } }, null, 2)}\n`, 'utf8')
// Workspace B: a file (and folder) the run created, holding the rule alone.
const other = await scratchRepository('locust-drive-rules-after-quit-other-')
const fileB = join(other, '.cursor', 'cli.json')
await mkdir(join(other, '.cursor'), { recursive: true })
await writeFile(fileB, `${JSON.stringify({ permissions: { allow: [RULE], deny: [] } }, null, 2)}\n`, 'utf8')

const holds = {
  version: 1,
  folders: {
    [fileA]: { original: { createdFile: false, createdDir: false, hadPermissions: true, hadAllow: true, hadDeny: true }, rules: [RULE] },
    [fileB]: { original: { createdFile: true, createdDir: true, hadPermissions: false, hadAllow: false, hadDeny: false }, rules: [RULE] }
  }
}
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `cursor-rules-after-quit-${tag}`,
  port: 9849,
  sendsNothing: true,
  workspace,
  outPath: join(recordRoot('cursor-rules-after-quit-2026-10-04'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'cursor', model: 'auto', mode: 'approve-each' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: { 'cursor-connector-holds.json': holds }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const exists = (path) => readFile(path, 'utf8').then(() => true, () => false)

try {
  await drive.capture('launched over the two folders an earlier run left', () => drive.ready())
  // The recovery runs at start, before any run; a moment for the writes to land.
  for (let i = 0; i < 40 && (await exists(fileB)); i += 1) await sleep(250)
  const a = JSON.parse(await readFile(fileA, 'utf8'))
  check('the person\'s file keeps their own rules and loses only the run\'s', JSON.stringify(a) === JSON.stringify({ version: 1, permissions: { allow: ['Shell(ls)'], deny: ['Shell(rm)'] } }), JSON.stringify(a))
  check('the file the run created is gone', !(await exists(fileB)), fileB)
  check('and so is the .cursor folder it made', !(await readFile(join(other, '.cursor')).then(() => true, (error) => error.code === 'EISDIR')), join(other, '.cursor'))
  const store = JSON.parse(await readFile(join(drive.profile, 'cursor-connector-holds.json'), 'utf8'))
  check('the profile\'s store holds nothing afterwards', store.version === 1 && Object.keys(store.folders).length === 0, JSON.stringify(store))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Two folders with rules an earlier run left; the app started and took them back. No model ran.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
