// Does a mission waiting on you say WHAT FOR, without opening it?
//
//   LOCUST_SPEND=1 node _tools/probe-a-waiting-mission-says-what-for.mjs
//
// The Missions screen gained a line under each title in 0.72.0: what the
// mission is doing, or `Pending: <what it asked>` when it stopped to ask.
// The doing half was driven; the PENDING half never was, and it sat in the
// plan as unobserved.
//
// Two earlier attempts measured nothing, and the reason is worth keeping:
// they seeded Approve-each on CLAUDE CODE. The mode is Codex-only and the
// app says so in as many words -- "Codex CLI only. Claude Code cannot stop
// and ask yet" (`status.ts`) -- so no approval was ever going to be raised
// and the empty result said nothing about the row. A probe on an
// unsupported route tests the seed, not the product.
//
// This one reuses `probe-approve-each-card`'s setup, which is known to
// produce a card, and then looks at the Missions screen instead of the
// thread.
//
// SPENDS one Codex turn on gpt-5.6-luna at low effort -- never astra.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Codex turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-approvecard-ws-')
const drive = await startDrive({
  name: 'a-waiting-mission-says-what-for',
  port: 9505,
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

  // The whole point of this probe: with the run stopped and waiting, the
  // Missions screen must say what it is waiting FOR.
  await drive.capture('the Missions row says what it is waiting for', async () =>
    drive.evaluate(`(async () => {
      const open = [...document.querySelectorAll('button, a')].find(n => /^(Conversations|Missions)$/.test(n.innerText.trim()))
      if (open === undefined) return 'no Missions button'
      open.click()
      await new Promise(r => setTimeout(r, 900))
      const row = document.querySelector('.lc-missionrow')
      if (row === null) return 'no mission row'
      const doing = row.querySelector('.lc-missionrow__doing')?.innerText.trim()
      const tag = row.querySelector('.lc-missionrow__tag')?.innerText.trim() ?? ''
      return JSON.stringify({
        tag,
        doing: doing ?? '(one line)',
        saysPending: /^Pending: /.test(doing ?? ''),
        // And it names the thing, rather than just saying something is waiting.
        namesWhat: (doing ?? '').length > 'Pending: '.length + 3
      }, null, 1)
    })()`))

  // Back to the thread, so the approval below is answered where it lives.
  await drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-row')].find(r => /Wren/.test(r.innerText))
    row?.click()
    await new Promise(r => setTimeout(r, 900))
    return true
  })()`)

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
