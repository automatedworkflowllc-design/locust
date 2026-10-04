// Does Claude Code ASK Locust before using a connector, and does the answer
// land?
//
//   LOCUST_SPEND=1 node _tools/probe-permission-host.mjs
//
// The permission host was proven by hand on 2026-09-10 with a throwaway
// server and by unit test over a real loopback socket. Neither is the app.
// This is: the built app, a real Claude Code run in Accept edits, a real
// connector call, a card on screen, a click on it, and the row it draws.
//
// `LOCUST_ASK_CONNECTORS=1` sends no allow rules, so the call has to ask --
// with the rules in place a connector the person has never asks, which is
// the normal state and Colin's ruling. This probe is about the asking.
//
// SPENDS one Claude Code turn on sonnet at low effort. `get_watchlists` reads.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-permhost-ws-')
const drive = await startDrive({
  name: 'permission-host',
  port: 9467,
  workspace,
  spends: true,
  env: { LOCUST_ASK_CONNECTORS: '1' },
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('ask for a connector call and wait for the card', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 700))
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Call the Robinhood connector tool get_watchlists once and reply with just the number of watchlists it returned.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      field.form.requestSubmit()
      for (let i = 0; i < 240; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (document.querySelector('[aria-label="Approval required"]')) break
      }
      const card = document.querySelector('[aria-label="Approval required"]')
      if (!card) return 'NO CARD within two minutes'
      return JSON.stringify({
        cardSays: card.innerText.replace(/\\\\s+/g, ' ').trim().slice(0, 260),
        buttons: [...card.querySelectorAll('.lc-approval__actions button')].map(b => b.innerText.trim())
      }, null, 1)
    })()`)
  })

  // The premise, OUTSIDE capture(): no card means the host was never asked,
  // and every reading below would be about a run that answered itself.
  const cardUp = await drive.evaluate(`document.querySelector('[aria-label="Approval required"]') !== null`)
  if (cardUp !== true) throw new Error('NOT ASKED: no approval card appeared, so the permission host was not in the loop')
  say('  the run stopped and asked')

  await drive.capture('approve it once, and read what the run did next', () => drive.evaluate(`(async () => {
    const card = document.querySelector('[aria-label="Approval required"]')
    const approve = [...card.querySelectorAll('.lc-approval__actions button')][0]
    const pressed = approve?.innerText.trim()
    approve?.click()
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1200))
    const fold = document.querySelector('.lc-activity')
    if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 400))
    const row = [...document.querySelectorAll('.lc-filerow')].find(r => /get_watchlists/.test(r.innerText))
    return JSON.stringify({
      pressed,
      cardStillUp: document.querySelector('[aria-label="Approval required"]') !== null,
      row: row ? row.innerText.replace(/\\\\s+/g, ' ').trim() : 'NO ROW',
      reply: (document.querySelector('.lc-agentline__body')?.innerText ?? '').replace(/\\\\s+/g, ' ').trim().slice(0, 120)
    }, null, 1)
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet in ACCEPT EDITS with LOCUST_ASK_CONNECTORS=1, so the connector call has to ask. The card is pressed by the probe.'
  })
}
