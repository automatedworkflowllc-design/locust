// A change to code, in colour (0.725), to look at before it ships.
//
//   node _tools/look-a-coloured-change.mjs [--packaged <exe>] [--out <dir>]
//
// Wren, on the free OpenCode model (nothing spent), edits cart.py in a plain folder: a docstring, a comment, a
// string and a keyword, so every colour a diff can carry is on screen. A frame of the opened change at 1215x800,
// and the count of coloured runs and changed words in the diff, read from the page. The record stays outside the
// repository.

import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-a-coloured-change')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const workspace = await mkdtemp(join(tmpdir(), 'locust-look-colour-ws-'))
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 'drive@locust.test')
git(workspace, 'config', 'user.name', 'Locust drive')
await writeFile(
  join(workspace, 'cart.py'),
  ['"""The cart: what is in it, and what it costs."""', '', '', 'def total(items):', '    # every item, at its price', '    return sum(item["price"] for item in items) * 2', ''].join('\n'),
  'utf8'
)
git(workspace, 'add', '.')
git(workspace, 'commit', '-q', '-m', 'first')

const drive = await startDrive({
  name: 'look-a-coloured-change',
  port: 9589,
  workspace,
  outPath,
  sendsNothing: false,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const OPEN_CHANGE = `(async () => {
  const row = [...document.querySelectorAll('.lc-filerow')].find((r) => /cart\\.py/.test(r.innerText) && /MODIFIED|\\+\\d/.test(r.innerText))
  if (!row) return 'no row'
  if (!document.querySelector('.lc-diff')) row.click()
  for (let i = 0; i < 20 && document.querySelectorAll('.lc-diff__code span[style]').length === 0; i += 1) await new Promise((r) => setTimeout(r, 250))
  document.querySelector('.lc-diff')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  return 'coloured runs: ' + document.querySelectorAll('.lc-diff__code span[style]').length + ' · changed words: ' + document.querySelectorAll('.lc-diff__word').length
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, 'Edit the existing file cart.py in this folder: in total(), remove the "* 2" so it returns the plain sum, and change the comment above it to say: every item, at its own price. Do not create any new file, change no other file, and run no commands.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return 'done'
  })()`)
  say(`the change: ${String(await drive.capture('the opened change', () => drive.evaluate(OPEN_CHANGE)))}`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on the free model edits cart.py; the change, in colour.` })
}
