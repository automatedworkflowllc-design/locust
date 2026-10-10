// The folder's changes in one panel (0.732), to look at before it ships, beside Claude Code's own.
//
//   node _tools/look-the-changes-panel.mjs [--packaged <exe>] [--out <dir>]
//
// A scratch repository on a branch `fix-totals` off main, with two commits, an edit not yet committed and a new
// file, in two folders. Wren, on the free model (nothing spent), answers one word so the conversation's header is
// up; Changes opens the panel. Frames of it at 1440x900: the tree and commits beside every diff, one commit alone,
// and the files hidden. The record stays outside the repository.

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-the-changes-panel')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const workspace = await mkdtemp(join(tmpdir(), 'locust-look-changes-ws-'))
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 'drive@locust.test')
git(workspace, 'config', 'user.name', 'Locust drive')
await mkdir(join(workspace, 'src', 'shop'), { recursive: true })
await writeFile(join(workspace, 'src', 'cart.py'), 'def total(items):\n    # every item, at its price\n    return sum(item["price"] for item in items) * 2\n', 'utf8')
await writeFile(join(workspace, 'src', 'shop', 'price.py'), 'PRICE = 1\n', 'utf8')
await writeFile(join(workspace, 'README.md'), '# Acme shop\n', 'utf8')
git(workspace, 'add', '.')
git(workspace, 'commit', '-q', '-m', 'first')
git(workspace, 'checkout', '-q', '-b', 'fix-totals')
await writeFile(join(workspace, 'src', 'cart.py'), 'def total(items):\n    # every item, at its own price\n    return sum(item["price"] for item in items)\n', 'utf8')
git(workspace, 'commit', '-q', '-am', 'Stop charging twice')
await writeFile(join(workspace, 'src', 'shop', 'price.py'), 'PRICE = 2\n', 'utf8')
git(workspace, 'commit', '-q', '-am', 'Raise the price')
await writeFile(join(workspace, 'README.md'), '# Acme shop\n\nTotals are the plain sum.\n', 'utf8')
await writeFile(join(workspace, 'src', 'shop', 'discount.py'), 'def discount(total):\n    return total * 0.9\n', 'utf8')

const drive = await startDrive({
  name: 'look-the-changes-panel',
  port: 9597,
  workspace,
  outPath,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
const READ = `(() => {
  const panel = document.querySelector('.lc-changes')
  if (!panel) return 'no panel'
  const head = panel.querySelector('.lc-changes__head')?.innerText.replace(/\\s+/g, ' ').trim()
  const tree = [...panel.querySelectorAll('.lc-changes__treefolder, .lc-changes__treefile')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
  const commits = [...panel.querySelectorAll('.lc-changes__commit')].map((el) => el.innerText.split('\\n')[0]).join(' / ')
  const files = [...panel.querySelectorAll('.lc-changes__filehead')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
  return 'HEAD ' + head + ' || TREE ' + tree + ' || COMMITS ' + commits + ' || FILES ' + files + ' || coloured ' + panel.querySelectorAll('.lc-diff__code span[style]').length
})()`
try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(Number(arg('--width') ?? 1440), Number(arg('--height') ?? 900))
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, 'Reply with the single word ok and run nothing.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 5 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'done'
  })()`)
  say(`all: ${String(await drive.capture('the changes panel, all changes', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === 'Changes')
    if (!button) return 'no Changes button'
    button.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-changes__filehead'); i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1200))
    return ${READ}
  })()`)))}`)
  say(`one commit: ${String(await drive.capture('one commit alone', () => drive.evaluate(`(async () => {
    const commit = [...document.querySelectorAll('.lc-changes__commit')].find((el) => el.innerText.includes('Raise the price'))
    if (!commit) return 'no commit row'
    commit.click()
    await new Promise((r) => setTimeout(r, 1500))
    return ${READ}
  })()`)))}`)
  await drive.capture('the files hidden', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-changes__commit')].find((el) => el.innerText.includes('All changes'))?.click()
    await new Promise((r) => setTimeout(r, 1200))
    document.querySelector('.lc-changes__head button[aria-label="Show files"]')?.click()
    await new Promise((r) => setTimeout(r, 500))
    return 1
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A branch with two commits, an edit and a new file; the Changes panel.` })
}
