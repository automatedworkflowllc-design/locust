// What a teammate published, as cards (0.727), to look at before it ships.
//
//   node _tools/look-published-cards.mjs [--packaged <exe>] [--out <dir>]
//
// Wren, on the free OpenCode model (nothing spent), replies with a Google Doc link and a bare Claude artifact
// address, as a teammate that published both would. A frame of the reply at 1215x800 and at 860x720, and the
// cards read from the page. The record stays outside the repository.

import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-published-cards')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const workspace = await mkdtemp(join(tmpdir(), 'locust-look-published-ws-'))
git(workspace, 'init', '-q', '-b', 'main')
git(workspace, 'config', 'user.email', 'drive@locust.test')
git(workspace, 'config', 'user.name', 'Locust drive')
await writeFile(join(workspace, 'README.md'), '# Acme\n', 'utf8')
git(workspace, 'add', '.')
git(workspace, 'commit', '-q', '-m', 'first')

const drive = await startDrive({
  name: 'look-published-cards',
  port: 9590,
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

const CARDS = `(async () => {
  document.querySelector('.lc-published')?.scrollIntoView({ block: 'center' })
  await new Promise((r) => setTimeout(r, 300))
  return [...document.querySelectorAll('.lc-published__card')].map((card) => card.innerText.replace(/\\s+/g, ' ')).join(' | ') || 'no cards'
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  await drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Message"]')
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, 'Reply with exactly these two lines and nothing else, and run no commands. Line one: The brand guide is up: [Brand guide](https://docs.google.com/document/d/1brandguide/edit) Line two: And the pricing page: https://claude.ai/artifact/pricing-page-AbCdEfGhIjKlMnOpQrStUv')
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
  say(`cards: ${String(await drive.capture('the reply, 1215', () => drive.evaluate(CARDS)))}`)
  await drive.resize(860, 720)
  await sleep(800)
  await drive.capture('the reply, 860', () => drive.evaluate(CARDS))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on the free model replies with two published links; the cards.` })
}
