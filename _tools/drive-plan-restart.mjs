// A plan is still a plan after the app is closed and opened again.
//
//   node _tools/drive-plan-restart.mjs
//
// An outside QA pass found this by reading the code (2026-09-06): the ledger
// recorded what a run was ALLOWED and never what was ASKED FOR, and `ask` and
// `plan` are both read-only -- so a plan reopened after a restart came back as
// an ordinary read-only run. Its "Build this plan" offer was gone, and in its
// place sat a sentence about the change being only in the reply, which is the
// wrong thing to say about a plan. Schema 15 records the mode; this is the
// check that a person actually gets the offer back.
//
// Spends one short Claude Code run in Plan mode.

import { rm } from 'node:fs/promises'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-plan-ws-')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

/** What the thread offers under a finished run, which is the whole question. */
const offers = `(() => {
  const buttons = [...document.querySelectorAll('button')].map(b => b.innerText.replace(/[ \\t\\n]+/g, ' ').trim()).filter(t => t.length > 0)
  const build = buttons.find(t => /build this plan/i.test(t))
  const rerun = buttons.find(t => /run again with edits/i.test(t))
  const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 130) ?? 'no header'
  const tail = document.querySelector('.lc-thread')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(-200) ?? ''
  return 'build offer: ' + (build ?? 'ABSENT') + ' || rerun offer: ' + (rerun ?? 'absent') + ' || header: ' + header + ' || thread ends: ' + tail
})()`

let drive = await startDrive({ name: 'plan-restart', port: 9312, workspace, seed, keep: true })
let handoff

try {
  await drive.capture('a plan run, finished', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 500)) })()`)
    const route = await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
    const mode = await drive.evaluate(`(async () => {
      const control = [...document.querySelectorAll('.lc-control')].find(b => /Ask|Accept edits|Plan|Approve|Auto/.test(b.innerText))
      control.click(); await new Promise(r => setTimeout(r, 400))
      ;[...document.querySelectorAll('[role=menuitemradio]')].find(b => /^Plan\\b/.test(b.innerText.trim()))?.click()
      await new Promise(r => setTimeout(r, 400))
      return control.innerText.replace(/[ \\t\\n]+/g, ' ').trim()
    })()`)
    await drive.evaluate(sendAndWaitScript('Plan how you would add a LICENSE file to this project. Do not edit anything.', { waitSeconds: 300 }))
    return `${String(route)} || mode: ${String(mode)}`
  })

  await drive.capture('what the finished plan offers, before any restart', () => drive.evaluate(offers))

  handoff = await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Claude Code / sonnet in Plan mode, then the app closed and opened again.',
    last: false
  })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  drive = await startDrive({
    name: 'plan-restart',
    port: 9312,
    workspace,
    profilePath: handoff.profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  await drive.capture('opened again: the same plan, from the ledger', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      const row = ${teammateRows()}.find(r => /Wren/.test(r.innerText))
      row?.conversation?.click()
      await new Promise(r => setTimeout(r, 1400))
      return 'opened'
    })()`)
  })

  await drive.capture('what it offers now — the whole question', () => drive.evaluate(offers))
} catch (error) {
  say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Claude Code / sonnet in Plan mode, then the app closed and opened again.' })
  if (handoff !== undefined) await rm(handoff.profile, { recursive: true, force: true }).catch(() => undefined)
}
