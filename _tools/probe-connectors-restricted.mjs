// Can a teammate that may NOT edit anything still reach a connector?
//
//   LOCUST_SPEND=1 node _tools/probe-connectors-restricted.mjs
//
// Colin, 2026-09-09: "do you think thats acceptable for the user to only have
// access for mcp tools under auto or is that standard?"
//
// It was neither, and the reason Locust gave for it was wrong. `--restricted`
// never kept a person's MCP servers out -- the CLI's help names
// `--strict-mcp-config` as the flag that would, and running the argv by hand
// in an empty folder listed every connector on the account. The block was
// Locust's own `--disallowedTools mcp__*`, now removed.
//
// So this asks the question the removal answers: in ASK -- the most
// restricted mode there is, where every write to disk is refused -- can a
// teammate call a connector? It should, because a connector is not disk.
//
// SPENDS: one short Claude Code turn on sonnet. `get_watchlists` reads;
// nothing is placed and nothing is edited.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-probe-restricted-ws-')
const drive = await startDrive({
  name: 'connectors-restricted',
  port: 9460,
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
        route: { runtime: 'claude', model: 'sonnet', mode: 'ask', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch on Claude Code in Ask', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 700))
      const chip = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')
      return 'mode: ' + (chip?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none') + ' · title: ' + (chip?.getAttribute('title') ?? 'none')
    })()`)
  })

  // The premise, OUTSIDE capture(): Ask is the point. Any other mode answers
  // a question that was never in doubt.
  const mode = String(await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
  if (!/ask/i.test(mode)) throw new Error(`NOT THE TEST: the composer is in "${mode}", and the claim is about the RESTRICTED modes`)
  say(`  mode is ${mode}`)

  await drive.capture('call a connector that reads, from a run that may not write', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Call the Robinhood connector tool get_watchlists once and reply with just the number of watchlists it returned. If you have no such tool, reply exactly: NO TOOL.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    const fold = document.querySelector('.lc-activity')
    if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 500))
    return JSON.stringify({
      rows: [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim().slice(0, 70)),
      tail: (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-320) ?? 'no thread')
    }, null, 1)
  })()`))

  const thread = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`))
  say(/NO TOOL/.test(thread)
    ? '  STILL BLOCKED: the teammate reported no such tool'
    : '  REACHED IT: a run that may not write to disk called a connector')
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet in ASK, the mode that refuses every write to disk. Nothing edited, nothing placed.' })
}
