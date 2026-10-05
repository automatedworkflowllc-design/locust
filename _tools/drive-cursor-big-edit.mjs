// A Cursor edit of a large file is confirmed (0.650).
//
//   LOCUST_SPEND=1 node _tools/drive-cursor-big-edit.mjs [--packaged <exe>] [--model <id>] [--out <dir>]
//
// Spends: one short Cursor turn on the person's Cursor plan (Auto by default).
// Cursor completes an edit with one record that holds the file twice; past
// 256 KB the host set it aside and the call stayed open, so the files card said
// "not confirmed" on edits that had landed (ledger 3fc5a59a: four edits of a
// 399 KB file). Here Wren on Cursor changes one line near the end of a ~300 KB
// file: the file must change on disk, and its row must not say "not confirmed".

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const MODEL = arg('--model') ?? 'auto'
// --rewrite: the model rewrites the whole file (streamContent), as Grok did in the
// measured turn; a one-line edit carries no file and never reached the cap.
const REWRITE = process.argv.includes('--rewrite')
const ASK = REWRITE
  ? 'Rewrite big.ts in full with your file-writing tool: keep every line, but change each comment that says "a line of padding so the file is large enough to matter" to just "padded", and change the last line from status = "pending" to status = "done". Run no commands.'
  : 'In big.ts, change the last line from status = "pending" to status = "done". Use your edit tool. Change nothing else and run no commands.'
const outPath = arg('--out') ?? join(tmpdir(), 'locust-drive-cursor-big-edit')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const workspace = await mkdtemp(join(tmpdir(), 'locust-cursor-big-ws-'))
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 'drive@locust.test')
git(workspace, 'config', 'user.name', 'Locust drive')
// About 300 KB: past the 256 KB a record may hold even before Cursor doubles it.
const lines = Array.from({ length: REWRITE ? 1700 : 5000 }, (_, i) => `export const value${String(i)} = ${String(i)} // a line of padding so the file is large enough to matter`)
lines.push('export const status = "pending"')
await writeFile(join(workspace, 'big.ts'), lines.join('\n') + '\n', 'utf8')
git(workspace, 'add', '.')
git(workspace, 'commit', '-q', '-m', 'first')
say(`big.ts: ${String(Buffer.byteLength(lines.join('\n')))} bytes`)

const drive = await startDrive({
  name: 'cursor-big-edit',
  port: 9589,
  workspace,
  outPath,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'cursor', model: MODEL, mode: 'accept-edits' } }],
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
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(ASK)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return 'sent'
  })()`)
  // Watched from here: one page script may take at most 400 s, and a full rewrite takes longer.
  const began = Date.now()
  for (let waited = 0; waited < 15 * 60_000; waited += 3000) {
    await sleep(3000)
    const running = await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`)
    if (waited > 6000 && running !== true) break
  }
  say(`the turn took ${String(Math.round((Date.now() - began) / 1000))} s`)
  await sleep(1500)
  const rows = JSON.parse(String(await drive.capture('the turn and its file rows', () => drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-filerow')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim()).filter((t) => /big\\.ts/.test(t)))`))))
  const onDisk = await readFile(join(workspace, 'big.ts'), 'utf8')
  check('the edit landed on disk', /status = "done"/.test(onDisk))
  check('a row names big.ts', rows.length > 0, JSON.stringify(rows))
  check('no big.ts row says "not confirmed" or "stopped"', rows.length > 0 && !rows.some((row) => /not confirmed|stopped before/.test(row)), JSON.stringify(rows))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on Cursor (${MODEL}) edits one line of a ~300 KB file.`, extra: `Checks failed: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
