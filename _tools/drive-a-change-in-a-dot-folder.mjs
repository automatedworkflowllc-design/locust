// Does a file a teammate wrote, in a folder Locust never reads, say that it changed (0.597)?
//
//   node _tools/drive-a-change-in-a-dot-folder.mjs [--packaged <exe>] [--tag <name>] [--plain] [--antigravity]
//
// The workspace is a git repository whose folder name starts with a dot
// (`.locust-drive-dotfolder-ws-…`), as Colin's `~/.claude` does. Locust never
// reads the text of a file under a dot-folder (0.489, the credentials rule), so
// every report a teammate wrote there drew "<runtime> did not report the
// change" and nothing else -- true, and useless. Since 0.597 the host still
// says it SAW the file change: the row reads "changed · seen on disk" beside
// the teammate's own word, with no diff underneath. --plain runs the same in
// an ordinary folder, the control: that row carries its diff.
//
// Which runtime matters. The free OpenCode model reports its own diff, so its
// row never said "did not report" in the first place (measured on the 0.596
// package: `report.md ADDED +1 -0` in the dot-folder too). The rows that did
// are the runtimes that name a file and send no change: Codex's file_change,
// Antigravity's write_to_file. --antigravity runs Wren on Antigravity Flash
// through its CLI (a real account's quota, so LOCUST_SPEND=1 is required);
// without it, Wren is on the free OpenCode model and nothing is spent.

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const plain = process.argv.includes('--plain')
const antigravity = process.argv.includes('--antigravity')
const route = antigravity ? { runtime: 'antigravity', model: 'flash', mode: 'accept-edits' } : { ...FREE_ROUTE, mode: 'accept-edits' }
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `a-change-in-a-dot-folder-${plain ? 'plain-' : ''}${antigravity ? 'antigravity-' : ''}${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })

// A repository whose own folder is a dot-folder (or not, for the control).
const workspace = await mkdtemp(join(tmpdir(), plain ? 'locust-drive-plainfolder-ws-' : '.locust-drive-dotfolder-ws-'))
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 'drive@locust.test')
git(workspace, 'config', 'user.name', 'Locust drive')
await writeFile(join(workspace, 'README.md'), '# scratch\n\nA scratch project for a user session.\n', 'utf8')
git(workspace, 'add', '.')
git(workspace, 'commit', '-q', '-m', 'first')
say(`workspace: ${workspace}`)

const drive = await startDrive({
  name: plain ? 'a-change-in-a-plain-folder' : 'a-change-in-a-dot-folder',
  port: 9586,
  workspace,
  spends: antigravity,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route }],
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
  await drive.capture('launch: Wren in the folder', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.capture('ask for report.md, and send', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Create a new file named report.md in this folder containing exactly one line: The passphrase is HERON-2291. Do not change any other file, and do not run any commands.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 2500))
    return 'sent'
  })()`))
  const rows = JSON.parse(String(await drive.capture('the file rows after the run', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    // The files card may be folded: open anything that says it edited or changed files.
    if (document.querySelectorAll('.lc-filerow').length === 0) {
      const head = [...document.querySelectorAll('button')].find(b => /Edited \\d+ file|changed \\d+ file|1 file/i.test(b.innerText))
      if (head) { head.click(); await new Promise(r => setTimeout(r, 800)) }
    }
    return JSON.stringify([...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()))
  })()`))))
  const onDisk = await readFile(join(workspace, 'report.md'), 'utf8').catch(() => undefined)
  check('Wren wrote report.md with the passphrase (ground truth, read from disk)', onDisk !== undefined && /HERON-2291/.test(onDisk), onDisk?.slice(0, 80))
  const row = rows.find((text) => /report\.md/.test(text))
  check('a row names report.md', row !== undefined, JSON.stringify(rows).slice(0, 300))
  if (plain) {
    check('in an ordinary folder the row carries its diff (ADDED, +1)', row !== undefined && /ADDED|\+1/.test(row), row)
  } else {
    check('in a dot-folder the row says the host saw it change', row !== undefined && /changed · seen on disk/.test(row), row)
    check('and not that the runtime did not report it', row !== undefined && !/did not report the change/.test(row), row)
    check("with Wren's own word kept", row !== undefined && /Write|Edit|write|edit/.test(row), row)
  }
  say(failures === 0 ? `\nA CHANGE IN A ${plain ? 'PLAIN' : 'DOT'} FOLDER PASSED` : `\nA CHANGE IN A ${plain ? 'PLAIN' : 'DOT'} FOLDER: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on ${antigravity ? 'Antigravity Flash (CLI)' : 'the free OpenCode model'} writes report.md in ${plain ? 'an ordinary folder (the control)' : 'a dot-folder, which Locust never reads'}; the file row afterwards.` })
}
