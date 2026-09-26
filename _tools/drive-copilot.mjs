// A first message on Copilot CLI, read as a person reads it.
//
//   LOCUST_SPEND=1 node _tools/drive-copilot.mjs [--packaged <exe>] [--tag <label>]
//
// Wren picks Copilot CLI / Auto from the composer, read-only, and is asked
// one sentence about README.md. Kept: the picker's rows under Copilot, the
// thread, the fold, the header. Spends one premium request on Colin's
// Copilot plan.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `copilot-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-copilot-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  // One premium request on Colin's plan: the composer must stay on Copilot.
  spends: true,
  name: 'copilot',
  port: 9308,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Wren: choose Copilot CLI / Auto', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/copilot/i', search: 'auto', row: '/auto/i' }))
  })
  await drive.capture('read-only mode', () => drive.evaluate(`(async () => {
    const control = document.querySelector('button[aria-label="Permission mode"], button[title="Permission mode"]')
    control.click(); await new Promise(r => setTimeout(r, 300))
    const choice = [...document.querySelectorAll('[role=menuitemradio]')].find(b => /^Ask\\b/.test(b.innerText.trim()) && !b.disabled)
    if (choice) choice.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return control.innerText.replace(/\\s+/g, ' ').trim()
  })()`))
  await drive.capture('one sentence about README, and wait', () => drive.evaluate(sendAndWaitScript('Read README.md and tell me in one sentence what this project is. Do not edit anything.')))
  await drive.capture('the fold and the header', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-activity')
    // The is-open class is never set on the card. ActivityCard sets
    // aria-expanded on the button and nothing else, so this guard never
    // guarded anything. Harmless while earlier folds were closed anyway;
    // since 0.49.0 a finished turn's fold opens itself and this CLOSED it.
    if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 300))
    return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? '') + ' || ' + (fold?.innerText.replace(/\\s+/g, ' ').slice(0, 60) ?? 'no fold') + ' || ' + [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 240)
  })()`))
  await drive.capture('the sidebar', () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 220)`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Copilot CLI / Auto, read-only, one sentence about README.` })
}
