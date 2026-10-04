// Does a file attached to a message reach a teammate on its own branch (M16)?
//
//   node _tools/drive-attach-own-branch.mjs [--packaged <exe>] [--tag <name>] [--short-name]
//
// --short-name opens the project by its Windows 8.3 spelling (C:\...\LOCUST~1),
// the case 0.595 fixed: before it, Own branch refused such a folder as "inside
// a repository but not its root" and nothing ran; now Wren's tree is made
// under the folder's real name and the passphrase comes back the same way.
//
// Wren has Own branch on, so Wren runs in <project>/.locust/worktrees/tm_wren.
// NOTES.md is in the project folder but not in any commit, so Wren's tree
// does not have it. The person attaches it and asks what it says. The message
// named it relative to the project folder -- "Read this file: - NOTES.md" --
// which inside Wren's tree is nothing, and the passphrase never came back.
// Now the file is placed where Wren's run reads it.
//
// The OS file dialog cannot be driven, so the host is told what it would
// have returned (LOCUST_ATTACH_PATHS), as drive-attach-sent does; everything
// after that is the real code. On the free OpenCode model: nothing is spent.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const shortName = process.argv.includes('--short-name')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `attach-own-branch-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

/** The folder's Windows 8.3 spelling, from cmd itself; refused rather than guessed where the volume keeps none. */
function shortSpelling(folder) {
  const said = execFileSync('cmd.exe', ['/d', '/c', 'for', '%I', 'in', `(${folder})`, 'do', '@echo', '%~sI'], { encoding: 'utf8', windowsHide: true }).trim()
  if (said.length === 0 || said.toLowerCase() === folder.toLowerCase()) throw new Error(`no 8.3 spelling for ${folder}`)
  return said
}

const real = await scratchRepository('locust-drive-attachtree-ws-')
const workspace = shortName ? shortSpelling(real) : real
if (shortName) say(`the project is opened as ${workspace} (really ${real})`)
// After the first commit: in the project folder, in no branch.
await writeFile(join(real, 'NOTES.md'), '# Notes' + String.fromCharCode(10, 10) + 'The passphrase is HERON-2291.' + String.fromCharCode(10), 'utf8')
const drive = await startDrive({
  name: 'attach-own-branch',
  port: 9585,
  workspace,
  env: { LOCUST_ATTACH_PATHS: workspace + String.fromCharCode(47) + 'NOTES.md' },
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', worktree: true, route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.capture('launch: Wren on its own branch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  const tiles = String(await drive.capture('attach NOTES.md, as the picker would', () => drive.evaluate(`(async () => {
    const plus = document.querySelector('button[data-satellite="attach"]')
    if (!plus) return 'no attach control'
    plus.click()
    await new Promise(r => setTimeout(r, 900))
    const tiles = [...document.querySelectorAll('.lc-attached__tile')].map(t => t.textContent?.trim())
    return tiles.length === 0 ? 'NO TILE' : JSON.stringify(tiles)
  })()`)))
  check('NOTES.md is attached', /NOTES/.test(tiles), tiles)
  await drive.capture('ask what it says, and send', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'What is the passphrase in the attached file? Reply with the passphrase only. Do not edit any files.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 2500))
    return 'sent'
  })()`))
  const answer = String(await drive.capture('the answer', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 150; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1000))
    return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-400)
  })()`)))
  check('the passphrase came back from Wren’s own branch', /HERON-2291/.test(answer), answer.slice(-200))
  const tree = join(real, '.locust', 'worktrees', 'tm_wren')
  check(`Wren’s tree is under the folder’s real name (${tree})`, existsSync(join(tree, 'README.md')))
  say(failures === 0 ? '\nATTACH OWN BRANCH PASSED' : `\nATTACH OWN BRANCH: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren with Own branch on; NOTES.md in the project folder but in no commit, attached and asked about.${shortName ? ` The project was opened by its Windows short name, ${workspace}.` : ''}` })
}
