// Does a teammate's own connector list narrow what it may use without asking?
//
//   LOCUST_SPEND=1 node _tools/probe-teammate-connectors.mjs
//
// The rule: no list means every connector the person has (Colin's ruling);
// a list NARROWS -- only those without asking, anything else stops the run
// and asks through the permission host. Two teammates, seeded:
//
//   Jimothy  connectors: ['claude.ai Robinhood']   -> calls Robinhood: no card
//   Sable    connectors: ['claude.ai Gmail']       -> calls Robinhood: CARD
//
// Both in Accept edits, askConnectors OFF, nothing in the environment. The
// second is the one that proves narrowing is real: a Finance Bro gets
// Robinhood and not Gmail, and a Docs teammate reaching for Robinhood is
// asked.
//
// SPENDS two Claude Code turns on sonnet at low effort. get_watchlists reads;
// Sable's call is DENIED at the card, so it never runs at all.

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two Claude Code turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}
if (process.env.LOCUST_ASK_CONNECTORS === '1') {
  say('refusing to run: LOCUST_ASK_CONNECTORS is set, which would make everyone ask and prove nothing.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-tmconn-ws-')
const route = { runtime: 'claude', model: 'sonnet', mode: 'accept-edits', effort: 'low' }
const drive = await startDrive({
  name: 'teammate-connectors',
  port: 9469,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_jim', name: 'Jimothy', hue: 'lime', role: 'Custom', roleTitle: 'Finance Bro', createdAt: '2026-09-05T05:00:00.000Z', route, connectors: ['claude.ai Robinhood'] },
      { teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Docs & QA', createdAt: '2026-09-05T05:01:00.000Z', route, connectors: ['claude.ai Gmail'] }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false, askConnectors: false }
  }
})

const PROMPT = 'Call the Robinhood connector tool get_watchlists once and reply with just the number of watchlists it returned. If you cannot, reply exactly: BLOCKED.'

/** Pick a teammate, send the prompt, and watch for either a card or the end. */
const askAs = (name) => `(async () => {
  ${teammateFace(name)}?.click()
  await new Promise(r => setTimeout(r, 700))
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(PROMPT)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  let sawCard = false
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (document.querySelector('[aria-label="Approval required"]')) { sawCard = true; break }
    if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  return sawCard
})()`

const readOutcome = `(async () => {
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 2 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  const fold = document.querySelector('.lc-activity')
  if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
  await new Promise(r => setTimeout(r, 400))
  const row = [...document.querySelectorAll('.lc-filerow')].find(r => /get_watchlists/.test(r.innerText))
  return JSON.stringify({
    row: row ? row.innerText.replace(/\\\\s+/g, ' ').trim() : 'NO ROW',
    reply: (document.querySelector('.lc-agentline__body')?.innerText ?? '').trim().slice(0, 60)
  }, null, 1)
})()`

try {
  await drive.capture('Jimothy, narrowed to Robinhood, calls Robinhood: no card', async () => {
    await drive.ready()
    const sawCard = await drive.evaluate(askAs('Jimothy'))
    const outcome = JSON.parse(String(await drive.evaluate(readOutcome)))
    return JSON.stringify({ sawCard, ...outcome }, null, 1)
  })

  // The premise for the second half, OUTSIDE capture(): Jimothy must have
  // gone through WITHOUT asking, or narrowing is not what is being measured.
  const jimRow = String(await drive.evaluate(`([...document.querySelectorAll('.lc-filerow')].find(r => /get_watchlists/.test(r.innerText))?.innerText ?? '').replace(/\\\\s+/g, ' ')`))
  if (!/done/.test(jimRow)) throw new Error(`NOT THE TEST: Jimothy's own connector did not go through unasked (${jimRow})`)
  say('  Jimothy used his own connector without a card')

  await drive.capture('Sable, narrowed to Gmail, calls Robinhood: the card, then Deny', async () => {
    const sawCard = await drive.evaluate(askAs('Sable'))
    if (sawCard !== true) return 'NO CARD: Sable reached a connector outside her list without asking'
    const cardSays = await drive.evaluate(`document.querySelector('[aria-label="Approval required"]')?.innerText.replace(/\\\\s+/g, ' ').trim().slice(0, 140)`)
    await drive.evaluate(`(() => { const c = document.querySelector('[aria-label="Approval required"]'); [...c.querySelectorAll('.lc-approval__actions button')].find(b => /deny/i.test(b.innerText))?.click() })()`)
    const outcome = JSON.parse(String(await drive.evaluate(readOutcome)))
    return JSON.stringify({ sawCard, cardSays, ...outcome }, null, 1)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Two teammates on Claude Code / sonnet in Accept edits, each narrowed to one connector, askConnectors off, nothing in the environment. Both call Robinhood.'
  })
}
