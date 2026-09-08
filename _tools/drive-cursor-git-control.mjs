// Does Cursor need a git repository to behave?
//
//   node _tools/drive-cursor-git-control.mjs
//
// The diff smoke asks Cursor Agent / Composer 2.5 for two precise edits to
// one small file, in a workspace made with mkdtemp and NO `git init`. Twice
// it produced garbage, differently each time:
//
//   run 1 (2026-09-07)  +41 / -0 across ELEVEN files, file rows naming
//                       Cursor's own mirror under ~/.cursor/projects/
//   run 2 (2026-09-07)  notes.ts overwritten with the output of `ls --help`
//
// Both runs also spent 3-5 minutes and spawned subagents for a two-line
// edit. So before reading any of that as a defect in how Locust DRAWS a
// diff, the cheaper question: is a plain folder the problem?
//
// This is the control arm -- identical prompt, identical route, but a real
// git repository (scratchRepository does `git init` and a first commit).
// The non-git arm has already been run twice.
//
// Matters beyond the smoke: a person can point Locust at any folder, and if
// a bare one makes a runtime flail, that is a first-class finding.
//
// Spends one Cursor run.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const TARGET = 'notes.ts'
const SEED = [
  'export const status = "draft";',
  '',
  'export function describe(): string {',
  '  return status;',
  '}',
  ''
].join('\n')
const PROMPT =
  'Edit notes.ts: change the word "draft" to "final" on the line that has it, and add one new line at the end that reads // reviewed. Change nothing else and do not create any other file.'

const workspace = await scratchRepository('locust-cursor-git-ws-')
await writeFile(join(workspace, TARGET), SEED, 'utf8')

const drive = await startDrive({
  name: 'cursor-git-control',
  port: 9334,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z'
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const WATCH = `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(PROMPT)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 340; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? header.innerText.split(/\\s+/).join(' ') : ''
    if (/completed|failed|cancelled/i.test(text)) {
      const summary = document.querySelector('.lc-activity__summary, .lc-activity')
      return 'settled after ' + (i + 1) + 's :: ' + text.slice(0, 120)
        + ' || summary: ' + (summary ? summary.innerText.split(/\\s+/).join(' ').slice(0, 120) : 'none')
    }
  }
  return 'NEVER SETTLED in 340s'
})()`

try {
  await drive.capture('Wren on Cursor Agent / Composer 2.5, inside a git repo', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    return drive.evaluate(
      pickRouteScript({ group: '/cursor/i', search: 'composer 2.5', row: '/^composer 2.5/i' })
    )
  })

  await drive.capture('the same two edits the smoke asks for', () => drive.evaluate(WATCH))

  await drive.capture('what is actually on disk afterwards', async () => {
    const after = await readFile(join(workspace, TARGET), 'utf8').catch(() => '<<unreadable>>')
    const madeTheEdit = /final/.test(after) && /reviewed/.test(after)
    const intact = after.includes('export function describe')
    return [
      'did both edits: ' + madeTheEdit,
      'original code still there: ' + intact,
      'bytes: ' + after.length,
      'contents: ' + JSON.stringify(after.slice(0, 180))
    ].join('  ||  ')
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro:
      'Control arm: the diff smoke’s exact task, in a git repository instead of a bare temp folder.'
  })
}
