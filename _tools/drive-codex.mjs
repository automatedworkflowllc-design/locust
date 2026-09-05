// A full session on Codex CLI: an edit, a follow-up that builds on it, the
// diff in the fold, the conversation in the sidebar, the archive screen.
//
//   node _tools/drive-codex.mjs
//
// Wren on Codex CLI (account-default), Accept edits. Two turns of one
// conversation. Spends two short Codex runs on Colin's account.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-codex-ws-')
const drive = await startDrive({
  name: 'codex',
  port: 9304,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
const fold = `(async () => {
  const fold = document.querySelector('.lc-activity')
  if (!fold) return 'no activity fold'
  if (!fold.closest('.lc-card')?.classList.contains('is-open')) fold.click()
  await new Promise(r => setTimeout(r, 300))
  return fold.innerText.replace(/\\s+/g, ' ').slice(0, 60) + ' || ' + [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 300)
})()`

try {
  await drive.capture('launch: Wren on Codex CLI, Accept edits', () => drive.ready())
  await drive.capture('turn 1: create NOTES.md', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren').click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(sendAndWaitScript('Create a file named NOTES.md containing exactly two lines: "# Notes" and "First entry." Do not run shell commands. Reply with the single word DONE when it exists.'))
  })
  await drive.capture('the fold after turn 1', () => drive.evaluate(fold))
  await drive.capture('turn 2: a follow-up that builds on turn 1', () => drive.evaluate(sendAndWaitScript('Append one more line to NOTES.md: "Second entry." Keep the first two lines. Do not run shell commands. Reply with the single word DONE.')))
  await drive.capture('the fold after turn 2, and the sidebar', () => drive.evaluate(`(async () => {
    const folds = [...document.querySelectorAll('.lc-activity')]
    const last = folds[folds.length - 1]
    if (last && !last.closest('.lc-card')?.classList.contains('is-open')) last.click()
    await new Promise(r => setTimeout(r, 300))
    return folds.map(f => f.innerText.replace(/\\s+/g, ' ').slice(0, 50)).join(' / ') + ' || sidebar: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200)
  })()`))
  await drive.capture('the header: cost and turns', () => drive.evaluate(`document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 220) ?? ''`))
  await drive.capture('All missions (Ctrl 1): the archive', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="All missions (Ctrl 1)"]').click()
    await new Promise(r => setTimeout(r, 800))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' · ' + (document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || filters: ' + [...document.querySelectorAll('.lc-filter')].map(f => f.innerText.trim()).join('/') + ' || rows: ' + [...document.querySelectorAll('.lc-missionrow')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 120)).join(' | ')
  })()`))
  await drive.capture('filter Completed, then open the first row', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-filter')].find(f => f.innerText.trim() === 'Completed')?.click()
    await new Promise(r => setTimeout(r, 400))
    const rows = document.querySelectorAll('.lc-missionrow').length
    document.querySelector('.lc-missionrow')?.click()
    await new Promise(r => setTimeout(r, 800))
    return 'completed rows: ' + rows + ' || opened: ' + (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no workroom')
  })()`))
  const notes = await readFile(join(workspace, 'NOTES.md'), 'utf8').catch(() => 'absent')
  drive.record.push({ step: drive.record.length + 1, title: 'disk after the session', note: `NOTES.md: ${JSON.stringify(notes)}`, errors: [] })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Codex CLI, Accept edits; two turns of one conversation, then the archive screen.' })
}
