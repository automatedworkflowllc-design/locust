// An account shows how full it is (0.388): one real Codex turn, then Home.
//
//   LOCUST_SPEND=1 node _tools/drive-usage-ring.mjs [--packaged <exe>] [--tag <name>]
//
// SPENDS one tiny turn of the person's own Codex plan (the cheapest model the
// catalog lists, one word asked for). The round trip is the point: Codex's
// app-server pushes its rate-limit snapshot during a turn; 0.388 keeps it as
// a `codex.usage_window` reading; the host hands the latest to the window;
// Home's agents line rings Codex's mark with the fullest window and names the
// reading. A reading that never arrives is the finding, not a failure to hide.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('usage-ring-2026-09-27'), `usage-ring-${tag}`)
await mkdir(OUT, { recursive: true })
const MODEL = process.env.LOCUST_CODEX_MODEL ?? 'gpt-6-luna'

const workspace = await scratchRepository('locust-usage-ring-ws-')
const drive = await startDrive({
  name: `usage-ring-${tag}`,
  port: 9689,
  workspace,
  launchElsewhere: true,
  outPath: OUT,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-27T05:00:00.000Z', route: { runtime: 'codex', model: MODEL, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.ready()
  await drive.resize(1440, 900)
  say(String(await drive.evaluate(openTeammateScript('Juno'))))
  const route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.split(/\\s+/).join(' ').trim() ?? ''`))
  say(`route: ${route}`)
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly one word: ready. Do not use any tools.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const send = document.querySelector('button[aria-label="Start mission"]')
      if (send && !send.disabled) { send.click(); return 'sent' }
    }
    return 'could not send'
  })()`))
  say(`Juno: ${sent}`)
  await sleep(3000)
  for (let i = 0; i < 240; i += 1) {
    const live = String(await drive.evaluate(`String(!!document.querySelector('button[aria-label^="Stop the running"]'))`)) === 'true'
    if (!live) break
    await sleep(500)
  }
  await drive.capture('Juno answered on Codex', () => route)
  // Home: the agents line.
  await drive.evaluate(`document.querySelector('.lc-brand__lockup')?.click()`)
  await sleep(1500)
  const home = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
    const codex = document.querySelector('.lc-agenthead__marks .lc-runtimemark[data-runtime="codex"]')
    const ring = codex?.closest('.lc-usagering')
    return { label: codex?.getAttribute('aria-label') ?? null, used: ring?.getAttribute('data-used') ?? null, tone: ring?.className ?? null, folded: document.querySelector('.lc-agenthead.is-folded') !== null }
  })())`)))
  await drive.capture('Home: the agents line, Codex ringed', () => JSON.stringify(home))
  check('Home rings Codex’s mark with the reading its turn reported', home.used !== null && /^Codex CLI: \d{1,3}% of the /.test(home.label ?? ''), JSON.stringify(home))
  say(failures === 0 ? '\nUSAGE RING PASSED' : `\nUSAGE RING: ${String(failures)} FAILED`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Juno on Codex's ${MODEL}, one word asked -- then Home's agents line, to see the reading that turn reported as a ring round Codex's mark.` })
}
