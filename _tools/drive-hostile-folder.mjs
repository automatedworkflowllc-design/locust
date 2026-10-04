// Does opening a folder make Locust run a program the folder's git config names?
//
//   node _tools/drive-hostile-folder.mjs [--packaged <exe>] [--tag <label>]
//
// `core.fsmonitor` in a repository's own config is run by every `git status`,
// and Locust runs `git status` by itself: when a folder is opened, and before
// and after a run that may write. Measured 2026-09-25 from a shell: the
// program ran; Claude Code and OpenCode launched in the same folder did not
// run it. This opens such a folder, waits, runs one writing mission on the
// free model, and reports whether the program left its mark.
//
// Free model only.

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `hostile-folder-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-hostile-ws-')
const marker = join(workspace, 'fsmonitor-ran.txt').replace(/\\/g, '/')
await git(['config', 'core.fsmonitor', `echo ran >> "${marker}"; exit 1`], workspace)
const marks = async () => (existsSync(marker) ? (await readFile(marker, 'utf8')).split('\n').filter(Boolean).length : 0)

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'hostile-folder',
  port: 9316,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('the folder is opened', async () => {
    await drive.ready()
    await sleep(4000)
    return `times the folder's program ran: ${String(await marks())}`
  })
  await drive.capture('one writing run', async () => {
    await drive.evaluate(openTeammateScript('Wren'))
    const said = await drive.evaluate(sendAndWaitScript('Create a file named hello.txt containing the word hi.', { waitSeconds: 180 }))
    return `times the folder's program ran: ${String(await marks())} || ${said.slice(-160)}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A scratch repository whose .git/config sets core.fsmonitor to a command that appends a line to ${marker}. Wren on the free Ling, Edit mode.`
  })
}
