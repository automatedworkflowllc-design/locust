// What Locust says about a Gemini CLI that Google has stopped serving.
//
//   node _tools/drive-gemini-row.mjs
//
// Measured 2026-09-08 outside the app: every `gemini` run on this machine now
// fails with "IneligibleTierError: This client is no longer supported for
// Gemini Code Assist for individuals", and `--list-sessions` -- the command
// discovery probes with -- prints "Error authenticating:" before it.
//
// `readyWhen` in discovery.ts already tests for that phrase, so the runtime
// SHOULD come back not-ready with a reason a person can act on. This checks
// that it does, rather than assuming the guard still matches text Google has
// since reworded. No mission is sent.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-gemini-ws-')
const drive = await startDrive({
  name: 'gemini-row',
  port: 9385,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture('every runtime, as the footer counts them', () => drive.evaluate(`
    document.querySelector('.lc-connected')?.getAttribute('title')
      ?? [...document.querySelectorAll('*')].map(n => n.childElementCount === 0 ? n.textContent : '').find(t => /runtime/i.test(t ?? '')) ?? 'no count found'
  `))

  await drive.capture('the Gemini row in Settings', () => drive.evaluate(`(async () => {
    const settings = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Settings')
    if (!settings) return 'no Settings button'
    settings.click()
    await new Promise(r => setTimeout(r, 900))
    // The runtime rows are on the AI agents page in Settings (settingsPages.ts).
    ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'AI agents')?.click()
    await new Promise(r => setTimeout(r, 900))
    const rows = [...document.querySelectorAll('.lc-runtimerow')]
    const gemini = rows.find(row => /gemini/i.test(row.textContent ?? ''))
    return JSON.stringify({
      rowsFound: rows.length,
      gemini: gemini ? gemini.textContent?.replace(/\\s+/g, ' ').trim() : 'NO GEMINI ROW'
    }, null, 1)
  })()`))
} finally {
  await drive.finish({
    intro: 'Whether Locust still calls Gemini ready now that Google refuses the individual free tier outright.'
  })
}

say('done')
