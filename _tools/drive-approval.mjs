// A person meets an approval card, reads the change, and approves it.
//
//   node _tools/drive-approval.mjs
//
// Wren on Codex CLI in "Approve each action" mode is asked to create one
// file. What a person sees: the run stopping at the card, the card naming
// the file and showing the added line, the Approve press, the run finishing,
// the file on disk. Spends one short Codex run on Colin's account.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-approval-ws-')
const drive = await startDrive({
  name: 'approval',
  port: 9294,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'account-default', mode: 'approve-each' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 6, memoryMode: 'off' }
  }
})

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('pick Wren: the composer shows Approve each action on Codex', () => drive.evaluate(`(async () => {
    const who = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren')
    who.click()
    await new Promise(r => setTimeout(r, 500))
    return [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  })()`))
  await drive.capture('ask for a new file and wait for the card', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Using your file-editing tool (apply_patch), create a new file named HELLO.txt in this directory containing exactly the line: hello from wren. Do not run shell commands and do not ask me anything first.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const approval = document.querySelector('[role=group][aria-label="Approval required"]')
      if (approval) {
        await new Promise(r => setTimeout(r, 400))
        return 'card: ' + approval.innerText.replace(/\\s+/g, ' ').slice(0, 220)
      }
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'run ended with no card: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-200) ?? '')
    }
    return 'no card within 4 minutes'
  })()`))
  await drive.capture('the sidebar and header while the card waits', () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 200) + ' || ' + (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? '')`))
  await drive.capture('press Approve and wait for the run to finish', () => drive.evaluate(`(async () => {
    let approvals = 0
    for (let i = 0; i < 600; i += 1) {
      const approval = document.querySelector('[role=group][aria-label="Approval required"]')
      const approve = approval && [...approval.querySelectorAll('button')].find(b => /^Approve/.test(b.innerText.trim()) && !b.disabled)
      if (approve && approvals < 4) { approve.click(); approvals += 1; await new Promise(r => setTimeout(r, 800)); continue }
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'ended after ' + approvals + ' approval(s): ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-240) ?? '')
      await new Promise(r => setTimeout(r, 500))
    }
    return 'still running after ' + approvals + ' approval(s)'
  })()`))
  await drive.capture('open the activity fold', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-activity')
    if (!fold) return 'no activity fold'
    fold.click()
    await new Promise(r => setTimeout(r, 300))
    return [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 300)
  })()`))
  const written = existsSync(join(workspace, 'HELLO.txt')) ? JSON.stringify(await readFile(join(workspace, 'HELLO.txt'), 'utf8')) : 'absent'
  drive.record.push({ step: drive.record.length + 1, title: 'disk after the session', note: `HELLO.txt: ${written}`, errors: [] })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Codex CLI, Approve each action, asked to create HELLO.txt. Approve pressed by the drive.' })
}
