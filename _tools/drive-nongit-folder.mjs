// What happens in a folder that is not a git repository?
//
//   node _tools/drive-nongit-folder.mjs
//
// Every drive so far has used scratchRepository(), which does `git init` and
// a first commit. A first outside tester will point Locust at whatever folder
// they have -- Documents, a download, a half-started project -- and most of
// those are not repositories.
//
// This matters beyond tidiness: disk-observation computes a file's change
// with `git diff --no-index`, and the diff smoke's workspace (mkdtemp, no
// init) is where Cursor produced garbage twice. So: does an edit in a plain
// folder still show a diff, and does anything warn?
//
// Free model, so it costs nothing.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickRouteScript, say, startDrive } from './drive-lib.mjs'

// Deliberately NOT scratchRepository: a plain folder with one file in it.
const workspace = await mkdtemp(join(tmpdir(), 'locust-nongit-'))
await writeFile(join(workspace, 'notes.txt'), 'status: draft\n', 'utf8')

const drive = await startDrive({
  name: 'nongit-folder',
  port: 9342,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const RUN = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Change the word draft to final in notes.txt. Change nothing else.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\s+/).join(' ') : ''
    if (/completed|failed|cancelled/i.test(text)) {
      const rows = [...document.querySelectorAll('.lc-filerow__path')].map((n) => n.innerText.trim())
      const trace = document.querySelector('.lc-activity')
      return 'settled in ' + (i + 1) + 's :: ' + (text.match(/completed|failed|cancelled/i) ?? ['?'])[0]
        + ' || file rows: ' + (rows.length ? rows.join(', ') : 'none')
        + ' || trace: ' + (trace ? trace.innerText.split(/\s+/).join(' ').slice(0, 120) : 'no fold')
    }
  }
  return 'never settled'
})()`

try {
  await drive.capture('a plain folder, no git', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('edit one file in it', () => drive.evaluate(RUN))

  await drive.capture('what the file says now', async () => {
    const { readFile } = await import('node:fs/promises')
    const after = await readFile(join(workspace, 'notes.txt'), 'utf8').catch(() => '<<unreadable>>')
    return 'edited: ' + /final/.test(after) + ' || contents: ' + JSON.stringify(after.slice(0, 80))
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Locust pointed at a folder that is not a git repository, which is what most folders are.' })
}
