// Cloud from a folder that is not on GitHub: named, and the way to one that is (0.504).
//
//   node _tools/drive-cloud-from-a-folder-not-on-github.mjs --repo <a clone of a GitHub repo> [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-30, at "This folder is not on GitHub, so the cloud has
// nothing to work on": "i have no idea what folder the cloud is in". The
// window starts in a folder with no GitHub remote; Locust already knows the
// clone. Picking Cloud must open the panel (not refuse in the menu), name
// this folder, list the clone with Open, and Open must take the window there
// with the panel on that repository. Starts no cloud task: spends nothing.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openTeammateScript, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const repo = arg('--repo')
if (repo === undefined) {
  say('usage: node _tools/drive-cloud-from-a-folder-not-on-github.mjs --repo <clone> [--packaged <exe>]')
  process.exit(2)
}
const workspace = await scratchRepository('locust-drive-not-on-github-ws-')
const profile = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-not-on-github-profile-'))
// Locust already knows the clone, as it would after the person opened it once.
await writeFile(join(profile, 'folders.json'), JSON.stringify({ folders: [{ id: 'ws_drive_clone', path: resolve(repo) }] }), 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `cloud-not-on-github-${tag}`,
  port: 9809,
  workspace,
  profilePath: profile,
  sendsNothing: true,
  outPath: join(recordRoot('cloud-task-2026-09-30'), `not-on-github-${tag}`),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_coda', name: 'Coda', hue: 'teal', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' } }],
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
  open: !!document.querySelector('.lc-cloudtasks'),
  head: document.querySelector('.lc-cloudtasks .lc-beside__title')?.innerText.trim() ?? null,
  elsewhere: document.querySelector('.lc-cloudtasks__elsewhere')?.innerText.replace(/\\s+/g, ' ').trim() ?? null,
  folders: [...document.querySelectorAll('.lc-cloudtasks__folders li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim()),
  note: document.querySelector('.lc-composer .lc-notice')?.innerText.trim() ?? null
})`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Coda'))
  await drive.evaluate(`(async () => {
    document.querySelector('.lc-control--chatmode')?.click()
    await new Promise((r) => setTimeout(r, 400))
    ;[...document.querySelectorAll('.lc-menu [role="menuitemradio"]')].find((el) => /^Cloud/.test(el.innerText.trim()))?.click()
    await new Promise((r) => setTimeout(r, 2500))
  })()`)
  const here = JSON.parse(String(await drive.capture('Cloud picked in a folder not on GitHub', () => drive.evaluate(panel))))
  check('picking Cloud opens the panel instead of a refusal in the menu', here.open && here.note === null, JSON.stringify(here))
  check('the panel names this folder and says why', /locust-drive-not-on-github-ws-\S+ is not on GitHub/.test(here.elsewhere ?? ''), here.elsewhere)
  check('and lists the folder that is on GitHub, with Open', here.folders.some((row) => /locust-cloud-test/.test(row) && /Open/.test(row)), JSON.stringify(here.folders))

  const there = JSON.parse(String(await drive.capture('Open on the GitHub folder', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-cloudtasks__folders li')].find((li) => /locust-cloud-test/.test(li.innerText))
    row?.querySelector('button')?.click()
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 300))
      if (/locust-cloud-test/.test(document.querySelector('.lc-cloudtasks .lc-beside__title')?.innerText ?? '')) break
    }
    await new Promise((r) => setTimeout(r, 800))
    return ${panel}
  })()`))))
  check('Open takes the window there, the panel on that repository, ready', /locust-cloud-test/.test(there.head ?? '') && there.elsewhere === null, JSON.stringify(there))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Starts in a folder with no GitHub remote.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
