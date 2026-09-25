// Does a file attached to a message reach a teammate on its own branch (M16)?
//
//   node _tools/drive-attach-own-branch.mjs [--packaged <exe>] [--tag <name>]
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

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `attach-own-branch-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-attachtree-ws-')
// After the first commit: in the project folder, in no branch.
await writeFile(join(workspace, 'NOTES.md'), '# Notes' + String.fromCharCode(10, 10) + 'The passphrase is HERON-2291.' + String.fromCharCode(10), 'utf8')
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
    const box = document.querySelector('textarea[aria-label="Mission instruction"]')
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
  say(failures === 0 ? '\nATTACH OWN BRANCH PASSED' : `\nATTACH OWN BRANCH: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren with Own branch on; NOTES.md in the project folder but in no commit, attached and asked about.` })
}
