// A turn's changes can be undone, from the turn itself (0.674).
//
//   node _tools/drive-a-turn-can-be-undone.mjs [--packaged <exe>] [--tag <name>]
//
// Claude Code rewinds; a Locust turn wrote straight into the folder with no way back. Wren (a free model,
// Edit) changes one line of notes.txt and makes hello.md, in a plain folder. Then the person edits
// hello.md by hand, as people do. The turn's foot must offer "Undo these changes", ask first in words,
// put notes.txt back byte for byte, leave hello.md as the person left it and say why -- and still say
// it was undone after Locust is closed and opened again. Spends nothing.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('a-turn-can-be-undone-2026-10-06'), tag)
const NOTES = 'line one\r\nline two\r\nline three\r\n'
// A plain folder, not a repository: undo must not need the person's git.
const workspace = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-undo-ws-'))
await writeFile(join(workspace, 'notes.txt'), NOTES)
await writeFile(join(workspace, 'keep.md'), 'untouched\n')

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 300)}`}`)
}
const foot = `(() => document.querySelector('.lc-thread .lc-turnundo')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no undo line')()`

let drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-turn-can-be-undone-${tag}`, port: 9733, workspace, outPath: OUT, keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-05T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 820)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  const sent = await drive.capture('Wren edits notes.txt and makes hello.md', () => drive.evaluate(sendAndWaitScript("In notes.txt change the words 'line two' to 'line 2'. Then create hello.md holding the single line: hi. Change nothing else.")))
  say(`  sent: ${String(sent).slice(0, 120)}`)
  const edited = await readFile(join(workspace, 'notes.txt'), 'utf8').catch(() => '')
  check('the turn changed notes.txt and made hello.md', edited.includes('line 2') && existsSync(join(workspace, 'hello.md')), JSON.stringify({ notes: edited, hello: existsSync(join(workspace, 'hello.md')) }))
  // The person edits hello.md by hand afterwards.
  await writeFile(join(workspace, 'hello.md'), 'hi, and a line I wrote myself\n')
  await sleep(1500)
  const offered = String(await drive.evaluate(foot))
  check('the finished turn offers "Undo these changes"', /Undo these changes/.test(offered), offered)
  const asked = String(await drive.capture('Undo, asked', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-turnundo__ask')?.click()
    await new Promise((r) => setTimeout(r, 400))
    return ${foot}
  })()`)))
  check('it asks first, in words: how many files, and that one changed since is left alone', /Put back the 2 files this turn changed/.test(asked) && /changed since is left as it is/.test(asked) && /Keep them/.test(asked), asked)
  const done = String(await drive.capture('Undone', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-turnundo__go')?.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-turnundo.is-done'); i += 1) await new Promise((r) => setTimeout(r, 250))
    return ${foot}
  })()`)))
  check('it says what it did, and names the file it left alone and why', /Undone: 1 file put back as it was before this turn/.test(done) && /hello\.md left as it is: changed since the turn/.test(done), done)
  check('notes.txt is back, byte for byte (its CRLF too)', (await readFile(join(workspace, 'notes.txt'), 'utf8')) === NOTES, JSON.stringify(await readFile(join(workspace, 'notes.txt'), 'utf8')))
  check('hello.md is as the person left it', (await readFile(join(workspace, 'hello.md'), 'utf8')) === 'hi, and a line I wrote myself\n')
  check('a file the turn never touched is untouched', (await readFile(join(workspace, 'keep.md'), 'utf8')) === 'untouched\n')
  check('nothing was made in the folder for it: no .git', !existsSync(join(workspace, '.git')))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on ${FREE_ROUTE.model}, Edit, in a plain folder.`, extra: `Checks failed: ${String(failures)}` })
}

// Closed and opened again: the turn still says it was undone, and offers nothing more.
const profilePath = drive.profile
drive = await startDrive({ ...(packaged === undefined ? {} : { packaged }), name: `a-turn-can-be-undone-${tag}-again`, port: 9733, workspace, outPath: join(OUT, 'after-relaunch'), profilePath, stepFrom: 5 })
try {
  await drive.ready()
  await drive.resize(1200, 820)
  await drive.evaluate(openTeammateScript('Wren'))
  await sleep(1200)
  await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-convrow button.lc-conv')].find((r) => /notes\\.txt/i.test(r.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1500))
  })()`)
  const again = String(await drive.capture('after a relaunch', () => drive.evaluate(foot)))
  check('opened again, the turn still says it was undone', /Undone: 1 file put back as it was before this turn/.test(again) && !/Undo these changes/.test(again), again)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Relaunched on the same profile.', extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
