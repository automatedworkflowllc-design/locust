// Can a teammate reach the person's connectors?
//
//   LOCUST_SPEND=1 node _tools/probe-connectors.mjs
//
// Colin, 2026-09-09: "should we honestly set all claude sessions to their
// claude project folder by default? because otherwise they cant use mcp".
//
// The answer turns on there being TWO mechanisms, which look the same from
// the outside and are not:
//
//   account connectors   surfaced by claude.ai into any Claude Code session
//                        signed into that account, named `mcp__claude_ai_*`.
//                        NOT folder-scoped -- the session writing this probe
//                        has them with its cwd in the Locust repo.
//   local MCP servers    declared in ~/.claude.json under a PROJECT KEY, so
//                        they exist in one folder and nowhere else. Colin's
//                        `robinhood-trading` is one of these, registered to
//                        C:/Users/<home>/claude.
//
// If the first kind arrives, the folder question is answered: moving every
// Claude teammate into one folder would be borrowing the wrong lever, and
// would put them all in the wrong project to fix a thing the folder does not
// control. The second kind needs user-scope registration instead.
//
// Auto mode, because Auto is the one mode that drops `--restricted` and so
// the only one where the person's settings are read at all.
//
// SPENDS: one short Claude Code turn on sonnet. Nothing is edited -- the
// mission is asked to list, not to act.

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-probe-connectors-ws-')
const drive = await startDrive({
  name: 'connectors',
  port: 9456,
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
        route: { runtime: 'claude', model: 'sonnet', mode: 'auto', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})

try {
  await drive.capture('launch on Claude Code in Auto', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 700))
      const chip = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
      return 'route: ' + (chip?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none') +
        ' · mode: ' + ([...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none')
    })()`)
  })

  // The premise, outside capture(): Auto is the ONLY mode where the person's
  // settings are read, so anything else answers a different question.
  const mode = String(await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
  if (!/auto/i.test(mode)) throw new Error(`NOT A CONNECTOR TEST: the composer is in "${mode}", and only Auto reads the person's settings`)
  say(`  mode is ${mode}`)

  await drive.capture('ask it what tools it actually has', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'List the names of every tool you can call whose name begins with mcp__. Just the names, one per line, nothing else. If there are none, reply exactly: NONE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-700) ?? 'no thread')
  })()`))

  await drive.capture('and whether the hook noise is gone', () => drive.evaluate(`'stop hook rows: ' + [...document.querySelectorAll('[role=alert], .lc-diagnostic')].filter(n => /stop hook/i.test(n.innerText)).length`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on Claude Code / sonnet in AUTO, asked to name its own mcp__ tools. Nothing edited.' })
}
