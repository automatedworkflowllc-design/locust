// A teammate hands over a file it wrote in another folder Locust works in (0.516).
//
//   node _tools/drive-a-file-from-another-folder.mjs [--packaged <exe>] [--tag <name>]
//
// A teammate working in one folder wrote a report in another and handed it as
// `../other/report.md`; the button was never drawn, and it learned to copy
// files into its own folder instead (its memory, 2026-10-01). Ash works in
// one scratch folder; a second, which Locust knows, holds a report. Ash hands
// it over by a `..` path: the button must be drawn and its preview must show
// the report. A path to a folder Locust does not know must be refused when
// pressed. Free model.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-file-elsewhere-ws-')
// The other folder, beside the workspace, which Locust has worked in.
const other = await scratchRepository('locust-drive-file-elsewhere-other-')
await writeFile(join(other, 'report.md'), '# The other folder\n\nTHE REPORT FROM THE OTHER FOLDER.\n', 'utf8')
// And one Locust has never heard of.
const stranger = await mkdtemp(join(tmpdir(), 'locust-drive-file-elsewhere-stranger-'))
await writeFile(join(stranger, 'secret.md'), 'NOT FOR LOCUST\n', 'utf8')
const profile = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-file-elsewhere-profile-'))
await writeFile(join(profile, 'folders.json'), JSON.stringify({ folders: [{ id: 'ws_other', path: resolve(other) }] }), 'utf8')
const up = (folder) => `../${basename(folder)}`
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-file-from-another-folder-${tag}`,
  port: 9829,
  workspace,
  profilePath: profile,
  outPath: join(recordRoot('a-file-from-another-folder-2026-10-01'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.capture('Ash hands over two files by .. paths', () => drive.evaluate(sendAndWaitScript(
    `Do not use any tools. Reply with exactly the following lines and nothing else:\n<locust-file>\n${up(other)}/report.md :: the report\n${up(stranger)}/secret.md :: not ours\n</locust-file>`
  )))
  const buttons = JSON.parse(String(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-handedfile')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean))`)))
  check('a button is drawn for the file in the other folder', buttons.some((text) => /report\.md/.test(text)), JSON.stringify(buttons))
  const opened = String(await drive.capture('the other folder\'s report, opened', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find((b) => /report\\.md/.test(b.innerText) && !/secret/.test(b.innerText))
    button?.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-viewer'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 800))
    return document.querySelector('.lc-viewer')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? 'no viewer'
  })()`)))
  check('and it opens the report, from the folder Locust knows', /THE REPORT FROM THE OTHER FOLDER/.test(opened), opened)
  const refused = String(await drive.capture('the stranger\'s file, pressed', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-viewer .lc-viewer__close')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const button = [...document.querySelectorAll('button')].find((b) => /secret\\.md/.test(b.innerText))
    if (!button) return 'no button'
    button.click()
    await new Promise((r) => setTimeout(r, 1200))
    return (document.querySelector('.lc-viewer')?.innerText ?? '') + ' | ' + [...document.querySelectorAll('[role="status"], .lc-notice, .lc-tone-amber, .lc-tone-red')].map((el) => el.innerText).join(' / ')
  })()`)))
  check('a file in a folder Locust does not know is not shown', !/NOT FOR LOCUST/.test(refused), refused)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash in one folder, the report in another.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
