// Does the file count match what is on disk?
//
//   node _tools/drive-diff-count.mjs
//
// A first outside tester, on OPENCODE: "Alpha UI: 3s · 1 tool call · 2 files ·
// +2 −0. Git: one line in one file. Counter is wrong."
//
// I blamed Cursor's mirror paths and shipped nothing, because the tester was
// not on Cursor -- the fix was for a cause I had invented. This reproduces it
// instead: one append, to one file, on a free model, and then the app's own
// numbers next to `git diff --numstat`.
//
// Free model, so it costs no quota.

import { execFile } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const run = promisify(execFile)
const TARGET = 'notes.md'

const workspace = await scratchRepository('locust-diffcount-ws-')
await writeFile(join(workspace, TARGET), '# notes\n\nStatus: untouched\n', 'utf8')
await run('git', ['add', '-A'], { cwd: workspace })
await run('git', ['commit', '-m', 'seed', '--quiet'], { cwd: workspace })

const drive = await startDrive({
  name: 'diff-count',
  port: 9351,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const RUN = `(async () => {
  const flat = (el) => el.innerText.split('\\n').map((t) => t.trim()).filter(Boolean).join(' ')
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, 'Append exactly one new line to the end of notes.md that reads ALPHA-TOUCHED. Change nothing else and create no other file.')
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const header = document.querySelector('.lc-workroom__header')
    const text = header ? flat(header) : ''
    if (/completed|failed|cancelled/i.test(text)) {
      const fold = document.querySelector('.lc-activity')
      const trace = fold ? flat(fold).slice(0, 160) : 'no fold'
      // Open it: the summary is the claim, the rows are where the claim
      // comes from, and a collapsed fold hides which edit contributed what.
      if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
      await new Promise((r) => setTimeout(r, 600))
      // Only the rows that CLAIM a change. The reads are real rows but they
      // are not what the count is about, and they crowded the answer out of
      // the record last run.
      const rows = [...document.querySelectorAll('.lc-filerow')]
        .map(flat)
        .filter((t) => t.includes('+') || t.includes('−'))
      return 'settled: ' + (text.match(/completed|failed|cancelled/i) ?? ['?'])[0]
        + ' || trace: ' + trace
        + ' || rows: ' + (rows.length ? rows.join(' // ') : 'none')
    }
  }
  return 'never settled'
})()`

try {
  await drive.capture('a free model, Accept edits', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title')?.startsWith('Message Wren'))
      if (open) open.click()
      await new Promise((r) => setTimeout(r, 1000))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('one append to one file', () => drive.evaluate(RUN))

  await drive.capture('what git says, which is the truth', async () => {
    const numstat = await run('git', ['diff', '--numstat'], { cwd: workspace })
    const status = await run('git', ['status', '--porcelain'], { cwd: workspace })
    const after = await readFile(join(workspace, TARGET), 'utf8').catch(() => '<<unreadable>>')
    return 'git numstat: ' + (numstat.stdout.trim() || '(nothing)')
      + ' || git status: ' + (status.stdout.trim().split('\n').join(' ; ') || '(clean)')
      + ' || file ends: ' + JSON.stringify(after.slice(-40))
  })

  // Two rows that DISPLAY identically are not necessarily the same object --
  // the row relativises its path and the dedupe key does not. This reads the
  // ledger the app itself wrote, which is the only place the runtime's own
  // spelling survives.
  await drive.capture('what the runtime actually reported', async () => {
    const dir = join(drive.profile, 'mission-ledger')
    const names = await readdir(dir).catch(() => [])
    const text = (await Promise.all(names.map((name) => readFile(join(dir, name), 'utf8').catch(() => '')))).join('\n')
    const patches = []
    for (const line of text.split('\n')) {
      if (!line.includes('diff --git')) continue
      const record = JSON.parse(line)
      const patch = JSON.stringify(record).match(/diff --git[^"]{0,220}/g) ?? []
      for (const found of patch) patches.push(found.replace(/\\n/g, ' | '))
    }
    return patches.length === 0
      ? 'no patch reached the ledger'
      : patches.map((p, i) => `[${String(i + 1)}] ${p}`).join('   ~~~   ')
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One append to one file, and the app’s count beside git’s.' })
}
