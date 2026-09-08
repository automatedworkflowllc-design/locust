// The receipt at rest, and a teammate row that cannot stack five lines.
//
//   node _tools/drive-receipt-sidebar.mjs
//
// Two items from the design review, on one screen because they appear
// together: a recovered mission's DURABLE RECEIPT was a seven-row table open
// by default, and a teammate on its own branch replaying a routine stacked
// name, role+state, route, routine step and branch in a 268px rail.
//
// The receipt needs a mission that was RESTORED from the ledger, so this runs
// one, closes the app, and opens it again on the same profile.

import { rm } from 'node:fs/promises'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-receipt-ws-')
const seed = {
  schemaVersion: 1,
  teammates: [
    { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', worktree: true, createdAt: '2026-09-05T05:00:00.000Z' },
    { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', createdAt: '2026-09-05T05:00:01.000Z' }
  ],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto', autoMode: false }
}

let drive = await startDrive({ name: 'receipt-sidebar', port: 9320, workspace, seed, keep: true })
let handoff

try {
  await drive.capture('one run, so there is something to restore', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
    await drive.evaluate(sendAndWaitScript('Reply with exactly the word KEPT and nothing else.', { waitSeconds: 300 }))
    return 'ran'
  })

  handoff = await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/.', last: false })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  drive = await startDrive({
    name: 'receipt-sidebar',
    port: 9320,
    workspace,
    profilePath: handoff.profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  await drive.capture('the receipt, reopened from the ledger', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      const row = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
      row?.querySelector('.lc-teammate__mission')?.click()
      await new Promise(r => setTimeout(r, 1600))
      const summary = document.querySelector('.lc-receipt__summary')
      const table = document.querySelector('.lc-receipt')
      return 'summary: ' + (summary === null ? 'ABSENT' : summary.innerText.replace(/[ ]+/g, ' ').trim())
        + ' || table open at rest: ' + (table !== null)
    })()`)
  })

  await drive.capture('open it: the table is still there', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-receipt__summary')?.click()
    await new Promise(r => setTimeout(r, 500))
    const rows = document.querySelectorAll('.lc-receipt dt').length
    return 'rows behind the disclosure: ' + rows
  })()`))

  await drive.capture('the teammate rows, counted by line', () => drive.evaluate(`(() => {
    return [...document.querySelectorAll('.lc-teammate')].map(r => {
      const lines = r.innerText.split(String.fromCharCode(10)).map(t => t.trim()).filter(t => t.length > 0)
      return lines[0] + ': ' + lines.length + ' lines [' + lines.join(' / ') + ']'
    }).join('  ||  ')
  })()`))
} catch (error) {
  say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. A mission restored from the ledger, so the receipt draws, with one teammate on its own branch.' })
  if (handoff !== undefined) await rm(handoff.profile, { recursive: true, force: true }).catch(() => undefined)
}
