// Frames of the Copy buttons on a change (0.649), to look at before they ship.
//
//   node _tools/look-copy-a-change.mjs [--packaged <exe>] [--out <dir>]
//
// Wren, on the free OpenCode model (nothing spent), adds a line to README.md
// in a plain folder. Frames at 1215x800 and 860x720: the changed file's row
// (Copy beside Open and Show), the opened change with Copy at its foot, and
// both after a press ("Copied"). The record stays outside the repository.

import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-copy-a-change')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const workspace = await mkdtemp(join(tmpdir(), 'locust-look-copy-ws-'))
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 'drive@locust.test')
git(workspace, 'config', 'user.name', 'Locust drive')
await writeFile(join(workspace, 'README.md'), '# Acme Storefront\n\nThe website for a small online shop.\n', 'utf8')
git(workspace, 'add', '.')
git(workspace, 'commit', '-q', '-m', 'first')

const drive = await startDrive({
  name: 'look-copy-a-change',
  port: 9588,
  workspace,
  outPath,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const OPEN_ROW = `(async () => {
  const row = [...document.querySelectorAll('.lc-filerow')].find((r) => /README\\.md/.test(r.innerText) && /MODIFIED|\\+\\d/.test(r.innerText))
  if (!row) return 'no row'
  if (!document.querySelector('.lc-diff')) row.click()
  await new Promise((r) => setTimeout(r, 700))
  document.querySelector('.lc-diff__foot')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  return document.querySelector('.lc-diff__copy')?.getAttribute('aria-label') ?? 'no copy at the foot'
})()`
// A press as a person makes it: the clipboard takes text only from a real
// gesture, so a scripted click() reads "Not copied" where a mouse click copies.
const PRESS = async (selector) => {
  const at = JSON.parse(String(await drive.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)})
    if (!button) return 'null'
    button.scrollIntoView({ block: 'center' })
    const r = button.getBoundingClientRect()
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  })()`)))
  if (at === null) return 'none'
  for (const type of ['mousePressed', 'mouseReleased']) await drive.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
  await sleep(700)
  const said = String(await drive.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); return (b?.innerText.trim() ?? '') + ' | ' + (b?.getAttribute('title') ?? '') })()`))
  const pasted = String(await drive.evaluate(`navigator.clipboard.readText().then((t) => t, (e) => 'unread: ' + e.message)`))
  return `${said} || clipboard: ${JSON.stringify(pasted.slice(0, 160))}`
}

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, 'Edit the existing file README.md in this folder: add one line at the end that says exactly: Free shipping on orders over 50 dollars. Do not create any new file, change no other file, and run no commands.')
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
  say(`row copy: ${String(await drive.capture('1215: the changed file row, Copy beside Open and Show', () => drive.evaluate(`[...document.querySelectorAll('.lc-filerow__copy')].map((b) => b.getAttribute('aria-label')).join(' / ') || 'no row copy'`)))}`)
  say(`foot copy: ${String(await drive.capture('1215: the opened change, Copy at its foot', () => drive.evaluate(OPEN_ROW)))}`)
  say(`pressed: ${String(await drive.capture('1215: Copy pressed at the foot', () => PRESS('.lc-diff__copy')))}`)
  await sleep(2000)
  await drive.resize(860, 720)
  await sleep(800)
  await drive.capture('860: the opened change, Copy at its foot', () => drive.evaluate(OPEN_ROW))
  say(`row pressed: ${String(await drive.capture('860: Copy pressed on the row', () => PRESS('.lc-filerow__copy')))}`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on the free model edits README.md; the Copy buttons, looked at.` })
}
