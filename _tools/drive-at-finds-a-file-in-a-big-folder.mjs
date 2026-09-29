// QA-2026-09-29 round 2, R16: `@` finds a file in a big folder.
//
//   node _tools/drive-at-finds-a-file-in-a-big-folder.mjs [--packaged <exe>] [--tag <name>]
//
// A git folder of 6,000 files under docs/ and one file under packages/, which
// git lists after them: past the old cap of 5,000, where `@` found nothing and
// said nothing. Types `@target-in-packages` in the composer as a person would
// and reads the menu. Sends nothing.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('at-in-a-big-folder-2026-09-29'), `at-in-a-big-folder-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-at-big-ws-')
for (let part = 0; part < 60; part += 1) {
  const folder = join(workspace, 'docs', `part-${String(part).padStart(2, '0')}`)
  await mkdir(folder, { recursive: true })
  await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(folder, `record-${String(i)}.md`), 'x\n', 'utf8')))
}
await mkdir(join(workspace, 'packages', 'core'), { recursive: true })
await writeFile(join(workspace, 'packages', 'core', 'target-in-packages.ts'), 'export {}\n', 'utf8')
say('seeded 6,000 files under docs/ and one under packages/')

const drive = await startDrive({
  name: `at-in-a-big-folder-${tag}`, port: 9792, workspace, outPath: OUT, sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const menu = `JSON.stringify([...document.querySelectorAll('.lc-slash')].map((m) => m.innerText.replace(/\\s+/g, ' ').trim()))`
try {
  await drive.ready()
  await drive.resize(1440, 900)
  await sleep(1500)
  await drive.evaluate(`document.querySelector('.lc-composer__box textarea')?.focus()`)
  await drive.send('Input.insertText', { text: '@' })
  // The host lists the folder once, on the first @.
  await sleep(2500)
  for (const character of 'target-in') await drive.send('Input.insertText', { text: character })
  await sleep(800)
  const shown = JSON.parse(String(await drive.capture('@target-in, in a folder of 6,001 files', () => drive.evaluate(menu))))
  say(`  menu: ${JSON.stringify(shown)}`)
  check('the menu offers packages/core/target-in-packages.ts', shown.some((text) => /target-in-packages\.ts/.test(text) && /packages\/core/.test(text)), JSON.stringify(shown))
  check('and does not claim the list is partial, since it is not', !shown.some((text) => /first .* found/.test(text)), JSON.stringify(shown))
} finally {
  await drive.finish({ intro: '@ in a folder of 6,001 files, the one wanted past the old 5,000 cap (QA round 2, R16).' })
}
say('')
say(`record: ${OUT}`)
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
