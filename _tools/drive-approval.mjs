// A person meets an approval card, reads the change, and approves it.
//
//   node _tools/drive-approval.mjs
//
// Wren on Codex CLI in "Approve each action" mode is asked to create one
// file. What a person sees: the run stopping at the card, the card naming
// the file and showing the added line, the Approve press, the run finishing,
// the file on disk.
//
// Spends one short Codex run on Colin's account, at the cheapest setting the
// runtime offers. THAT COMMENT WAS WRONG and it cost real money: it said
// `model/list` reports exactly one model, so every Codex drive pinned
// `gpt-6-astra` -- which the picker describes as "our most capable model for
// complex, demanding work". Codex lists SIX, including `gpt-5.6-luna`,
// "fast and affordable agentic coding model". Colin, 2026-09-09, watching me
// spend it: "astra is very expensive brother, they have a ton of other models
// to use." Read from the picker with probe-codex-models.mjs, which sends
// nothing to any model. The drives run on the affordable one now --
// so there is no cheaper model to pick and the only lever is reasoning
// effort, which is pinned to `low` here. Colin, 2026-09-08: "use cheap models
// especially for codex". The prompt is deliberately one file and no shell.
//
// This is the ONLY drive that covers `approve-each`, and `modeRunsOn` makes
// that mode Codex-only -- so while this stayed gated, an entire permission
// mode went unexercised.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-approval-ws-')
const drive = await startDrive({
  spends: true,
  name: 'approval',
  port: 9294,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'approve-each', effort: 'low' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 6, memoryMode: 'off' }
  }
})

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('pick Wren: the composer shows Approve each action on Codex', () => drive.evaluate(`(async () => {
    const who = ${teammateFace('Wren')}
    who.click()
    await new Promise(r => setTimeout(r, 500))
    const controls = [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')
    /*
     * The effort is ASSERTED, not just printed. The seed saves Wren at low
     * effort, and selectTeammate used to restore runtime, model and mode while
     * silently dropping the effort -- so this read medium and the run cost
     * more than it had been asked to (found here, 2026-09-08).
     *
     * There is no unit test for it: the drop was one line inside a component
     * and this repo has no DOM to render one in. This drive is the guard, so
     * it has to fail loudly rather than print a wrong word quietly.
     *
     * No backticks in here: this comment lives inside a template literal, and
     * one would end it. That has cost this repo a debugging session before.
     */
    // Asserted POSITIVELY. A first version only looked for the wrong words
    // (medium/high/max) and so passed silently when the row said
    // "effort - fixed" instead -- which was a different bug, and one this
    // drive then found anyway on its third run.
    const kept = /(^| )low( |$)/.test(controls)
    return controls + (kept ? '' : ' || EFFORT DID NOT FOLLOW THE TEAMMATE (seeded low)')
  })()`))
  await drive.capture('ask for a new file and wait for the card', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Using your file-editing tool (apply_patch), create a new file named HELLO.txt in this directory containing exactly the line: hello from wren. Do not run shell commands and do not ask me anything first.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
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
    // Only when it is not already open. Since 0.49.0 a finished turn's fold
    // opens itself, so an unconditional click CLOSES it and every row below
    // then reads as absent -- a harness reporting a bare screen at an app
    // that is fine.
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
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
