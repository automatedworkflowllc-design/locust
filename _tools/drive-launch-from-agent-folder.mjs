// Launched from Claude Code's own folder, Locust does not make it the teammates' folder (0.572).
//
//   node _tools/drive-launch-from-agent-folder.mjs --packaged <exe> [--folder .copilot]
//
// Colin's ledger, 2026-10-03: Bro worked in ~/.claude and in Auto listed the
// credential files there. A launch folder was adopted whatever it was. This
// launches the built app with its working directory in ~/.claude and no
// folder argument, on a fresh profile (so nothing is remembered), and reads
// which folder the composer and the title bar name. Sends nothing. Home is a
// stand-in folder, so the real ~/.claude is never the launch folder.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
// Which agent's folder to launch from (0.587 added Copilot CLI's `.copilot`); Claude Code's by default.
const folderName = arg('--folder') ?? '.claude'
// A stand-in home (USERPROFILE), so neither build touches the real ~/.claude.
const home = await mkdtemp(join(tmpdir(), 'locust-fake-home-'))
const agentFolder = join(home, folderName)
await mkdir(agentFolder, { recursive: true })
// Electron reads its own folders from under home; a bare stand-in has none.
await mkdir(join(home, 'AppData', 'Roaming'), { recursive: true })
await mkdir(join(home, 'AppData', 'Local'), { recursive: true })
const fallback = await mkdtemp(join(tmpdir(), 'locust-default-ws-'))
const drive = await startDrive({
  name: 'launch-from-agent-folder', port: 9873, workspace: agentFolder, sendsNothing: true,
  outPath: join(recordRoot('launch-from-agent-folder-2026-10-03'), (packaged === undefined ? 'dev' : 'packaged') + (folderName === '.claude' ? '' : `-${folderName.replace(/^\./, '')}`)),
  env: { LOCUST_DEFAULT_WORKSPACE: fallback, USERPROFILE: home, HOME: home },
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
const checks = []
const check = (name, ok, seen) => { checks.push({ name, ok }); say(`  ${ok ? 'PASS' : 'FAIL'} ${name} -- ${seen}`) }
try {
  await drive.capture(`launched from ~/${folderName} with no folder argument`, async () => {
    await drive.ready()
    await sleep(3000)
    const seen = JSON.parse(String(await drive.evaluate(`JSON.stringify({
      title: document.title,
      folder: document.querySelector('.lc-control__anchor--folder')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
    })`)))
    const fallbackName = fallback.split(/[\\/]/).at(-1)
    check(`the composer does not name ${folderName} as the folder`, !seen.folder.toLowerCase().includes(folderName.toLowerCase()) && seen.folder.length > 0, JSON.stringify(seen))
    check('the folder named is the default Locust makes', seen.folder.includes(fallbackName.slice(0, 12)) || seen.title.includes(fallbackName), `want ${fallbackName}`)
    return JSON.stringify(seen)
  })
} finally {
  const failed = checks.filter((one) => !one.ok).length
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Launch from ~/${folderName}: ${String(checks.length - failed)}/${String(checks.length)}.` })
  process.exitCode = failed === 0 && checks.length > 0 ? 0 : 1
}
