// What does a person read when Meta refuses Muse Code for billing?
//
//   node _tools/drive-muse-billing.mjs [--packaged <exe>] [--tag <label>]
//
// Measured 2026-09-25 on muse 1.4.0: every run ended "API error 402 ...
// Billing verification failed. Please check your payment method.
// (billing_error)" -- Meta wants the account's payment method verified. The
// app printed that after "Muse Code ended failed:", which reads as Locust
// breaking. This sends one message on Muse and reports the card.
//
// Spends nothing: the refusal comes before any model runs.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `muse-billing-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-muse-billing-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'muse-billing',
  // Marked as spending, or drive-lib moves the composer to the free OpenCode
  // route and the run never reaches Muse Code (the first run of this drive did
  // exactly that). The refusal itself costs nothing.
  spends: true,
  port: 9318,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'muse', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('one message on Muse Code, and the card it ends on', async () => {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Wren'))
    // Picked in the picker, and checked: the seeded route alone left the
    // composer on Claude's account default, and that run answered on Opus.
    const route = await drive.evaluate(pickRouteScript({ group: '/muse/i', search: 'muse', row: '/muse/i' }))
    if (!/Muse Code/i.test(route)) return `NOT SENT: the route is not Muse Code -- ${route}`
    await drive.evaluate(sendAndWaitScript('Reply with exactly: OK', { waitSeconds: 120 }))
    return drive.evaluate(`(document.querySelector('.lc-card.is-red')?.innerText ?? document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-400)`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Muse Code (account default), Edit. This machine's Meta account answers every run with API error 402 billing_error.` })
}
