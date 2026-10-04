// Does Approve-each still stop and ask, now that it runs on the shared loop?
//
//   LOCUST_SPEND=1 node _tools/probe-approve-each-card.mjs
//
// The mode used to have a mission service of its own, because it was the only
// mode whose transport could stop and ask. Every Codex mode rides that
// transport now, so the service is gone and the mode is ordinary: the same
// start, the same ledger, plus an approval channel wired in for this mode
// alone. The unit tests hold the wiring; this holds the thing a person sees.
//
// It asks for a file to be written, which is an action Codex must ask about
// under `approvalPolicy: untrusted`. Then it presses Approve and checks the
// file is really there -- an approval that does not let the work through is
// as broken as one that never appears.
//
// SPENDS one Codex turn on gpt-5.6-luna at low effort. Never Astra.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Codex turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-approvecard-ws-')
const drive = await startDrive({
  name: 'approve-each-card',
  port: 9485,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'approve-each', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

// No backticks in here: the whole block is a template literal.
const waitForCard = `(async () => {
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const card = document.querySelector('[aria-label="Approval required"]')
    if (card !== null) {
      return JSON.stringify({
        card: card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 220),
        buttons: [...card.querySelectorAll('.lc-approval__actions button')].map(b => b.innerText.trim())
      })
    }
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) {
      return JSON.stringify({ card: 'NO CARD: the run ended without asking', buttons: [] })
    }
  }
  return JSON.stringify({ card: 'NO CARD: timed out', buttons: [] })
})()`

const approveEverything = `(async () => {
  let approved = 0
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const card = document.querySelector('[aria-label="Approval required"]')
    if (card !== null) {
      const yes = [...card.querySelectorAll('.lc-approval__actions button')].find(b => /approve/i.test(b.innerText))
      if (yes !== undefined) { yes.click(); approved += 1 }
    }
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1500))
  return JSON.stringify({
    approved,
    reply: ([...document.querySelectorAll('.lc-agentline__body')].at(-1)?.innerText ?? '').trim().slice(0, 120)
  })
})()`

try {
  await drive.capture('it stops and asks before writing a file', async () => {
    await drive.ready()
    await drive.evaluate(`${teammateFace('Wren')}?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Create a file called GANTRY.txt in this folder containing exactly the word gantry. Then reply with just: done')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      field.form.requestSubmit()
      return true
    })()`)
    return drive.evaluate(waitForCard)
  })

  // The premise for the rest, asserted OUTSIDE capture(): a card must have
  // appeared, or nothing below measures approvals at all.
  const sawCard = await drive.evaluate(`document.querySelector('[aria-label="Approval required"]') !== null`)
  if (sawCard !== true) throw new Error('NOT THE TEST: no card was on screen to approve')

  await drive.capture('approving lets the work through', async () => {
    const outcome = JSON.parse(String(await drive.evaluate(approveEverything)))
    let wrote = 'NOT WRITTEN'
    try {
      wrote = (await readFile(join(workspace, 'GANTRY.txt'), 'utf8')).trim()
    } catch {
      // Left as NOT WRITTEN: the file is the point, and its absence is the
      // finding rather than an error in the probe.
    }
    return JSON.stringify({ ...outcome, fileOnDisk: wrote }, null, 1)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Codex CLI / gpt-5.6-luna in Approve-each, asked to write a file. The card must appear, and approving it must let the write land.'
  })
}
