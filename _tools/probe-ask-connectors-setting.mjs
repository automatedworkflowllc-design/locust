// Does the Settings switch, not the env seam, make a connector call ask?
//
//   LOCUST_SPEND=1 node _tools/probe-ask-connectors-setting.mjs
//
// probe-permission-host.mjs proved the host with LOCUST_ASK_CONNECTORS=1 --
// a seam. This is the real control a person reaches: the profile is seeded
// with `askConnectors: true` and NOTHING in the environment, the Settings
// screen is read to confirm the switch shows on, and then a connector call
// in Accept edits has to stop and ask. If it goes through without a card the
// switch is decorative.
//
// SPENDS one Claude Code turn on sonnet at low effort. `get_watchlists` reads.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}
if (process.env.LOCUST_ASK_CONNECTORS === '1') {
  say('refusing to run: LOCUST_ASK_CONNECTORS is set, so this would measure the seam and not the switch.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-asksetting-ws-')
const drive = await startDrive({
  name: 'ask-connectors-setting',
  port: 9468,
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
        route: { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, askConnectors: true }
  }
})

try {
  await drive.capture('Settings shows the switch on, from the file alone', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      [...document.querySelectorAll('button, a')].find(n => /^settings$/i.test((n.innerText ?? '').trim()))?.click()
      await new Promise(r => setTimeout(r, 900))
      const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /^connectors$/i.test(h.innerText.trim()))
      if (!heading) return 'NO SECTION: nothing in Settings is headed Connectors'
      const section = heading.closest('.lc-settings__section')
      // Into view, so the step's screenshot shows the section and not the
      // top of the page. The first run read the switch from the DOM and
      // captured a screenshot of the project folder.
      section?.scrollIntoView({ block: 'start' })
      await new Promise(r => setTimeout(r, 300))
      const sw = section?.querySelector('[role="switch"]')
      return JSON.stringify({
        lede: section?.querySelector('.lc-settings__lede')?.innerText.trim(),
        switchOn: sw?.getAttribute('aria-checked'),
        switchLabel: sw?.getAttribute('aria-label')
      }, null, 1)
    })()`)
  })

  // The premise, OUTSIDE capture(): if the switch is not on, the run below
  // answers a question about the default, not about the setting.
  const on = await drive.evaluate(`(() => {
    const h = [...document.querySelectorAll('.lc-settings__heading')].find(h => /^connectors$/i.test(h.innerText.trim()))
    return h?.closest('.lc-settings__section')?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'
  })()`)
  if (on !== true) throw new Error('SWITCH NOT ON: the seeded askConnectors did not reach the Settings screen')
  say('  the switch reads on')

  await drive.capture('a connector call in Accept edits stops and asks, with no env seam', async () => {
    await drive.evaluate(`[...document.querySelectorAll('button, a')].find(n => /^missions$/i.test((n.innerText ?? '').trim()))?.click()`)
    await new Promise((r) => setTimeout(r, 600))
    return drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
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
        if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      const card = document.querySelector('[aria-label="Approval required"]')
      if (!card) return 'NO CARD: the call went through, or failed, without asking'
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
        asked: true,
        pressed,
        row: row ? row.innerText.replace(/\\\\s+/g, ' ').trim() : 'NO ROW',
        reply: (document.querySelector('.lc-agentline__body')?.innerText ?? '').trim().slice(0, 40)
      }, null, 1)
    })()`)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. askConnectors seeded ON in the profile, no environment seam. Settings is read first; then a connector call in Accept edits must ask.'
  })
}
