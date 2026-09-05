// First messages on the paid routes a person actually uses: Claude Code
// and Cursor Agent, one short run each, read as a person reads them.
//
//   node _tools/drive-routes.mjs
//
// Wren on Claude Code / sonnet, Booty on Cursor Agent / composer-2.5, both
// read-only, both asked one sentence about README.md. Kept: the route
// pickers, each thread, each activity fold, each header. Spends one short
// run on each of Colin's accounts.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-routes-ws-')
const drive = await startDrive({
  name: 'routes',
  port: 9301,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: '2026-09-05T05:00:00.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const pick = (name) => `(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message ${name}').click(); await new Promise(r => setTimeout(r, 500)); return 'picked ${name}' })()`
const askMode = `(async () => {
  const mode = document.querySelector('button[aria-label="Permission mode"], button[title="Permission mode"]')
  if (!mode) return 'no mode control'
  mode.click()
  await new Promise(r => setTimeout(r, 300))
  const choice = [...document.querySelectorAll('[role=menuitemradio]')].find(b => /^Ask\\b/.test(b.innerText.trim()))
  if (choice) choice.click()
  // No read-only on this runtime: leave the menu the way a person would.
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise(r => setTimeout(r, 300))
  return mode.innerText.replace(/\\s+/g, ' ').trim()
})()`
const fold = `(async () => {
  const fold = document.querySelector('.lc-activity')
  if (!fold) return 'no activity fold'
  if (!fold.closest('.lc-card')?.classList.contains('is-open')) fold.click()
  await new Promise(r => setTimeout(r, 300))
  return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? '') + ' || ' + [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 300)
})()`

try {
  await drive.capture('launch: two teammates with no route of their own yet', () => drive.ready())
  await drive.capture('Wren: choose Claude Code / sonnet', async () => {
    await drive.evaluate(pick('Wren'))
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
  })
  await drive.capture('Wren: read-only mode', () => drive.evaluate(askMode))
  await drive.capture('Wren on Claude Code: one sentence about README', () => drive.evaluate(sendAndWaitScript('Read README.md and tell me in one sentence what this project is. Do not edit anything.')))
  await drive.capture("Wren's activity fold and header", () => drive.evaluate(fold))
  await drive.capture('Booty: choose Cursor Agent / composer-2.5', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(pick('Booty'))
    // The row reads "Composer 2.5", a space and no hyphen; the id has the hyphen.
    return drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'composer', row: '/composer[ -]2\\.5/i' }))
  })
  await drive.capture('Booty: read-only mode', () => drive.evaluate(askMode))
  await drive.capture('Booty on Cursor: one sentence about README', () => drive.evaluate(sendAndWaitScript('Read README.md and tell me in one sentence what this project is. Do not edit anything.')))
  await drive.capture("Booty's activity fold and header", () => drive.evaluate(fold))
  await drive.capture('the sidebar: each teammate keeps the route it ran on', () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 300)`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Claude Code / sonnet, Booty on Cursor Agent / composer-2.5, read-only, one sentence each.' })
}
