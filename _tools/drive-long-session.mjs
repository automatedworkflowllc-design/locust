// Does the app get worse over a long conversation?
//
//   node _tools/drive-long-session.mjs
//
// A beta gate nobody had measured. Every other drive sends one or two turns
// and closes; a person keeps a teammate open all day. The question is not
// whether a turn works -- that is covered -- but whether the fifteenth turn
// costs more than the first: a renderer heap that only grows, a thread that
// redraws everything it has ever held, a ledger nobody bounds.
//
// Measured every few turns, and reported as a trend rather than a verdict:
//   - the renderer's JS heap (`performance.memory.usedJSHeapSize`)
//   - DOM nodes on screen
//   - how long a turn takes end to end
//   - the mission ledger's size on disk
//
// Nothing here fails a threshold. A number that climbs and never comes back
// is the finding; one that settles is the answer. Fifteen turns on OpenCode's
// FREE model, so the whole run costs nothing.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const TURNS = 15
const workspace = await scratchRepository('locust-drive-long-ws-')

const drive = await startDrive({
  name: 'long-session',
  port: 9313,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** What the window costs right now. `performance.memory` is Chromium-only, which this is. */
const reading = `(() => {
  const memory = performance.memory
  return {
    heapMb: memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1048576),
    nodes: document.getElementsByTagName('*').length,
    threadChars: (document.querySelector('.lc-thread')?.innerText ?? '').length,
    rows: document.querySelectorAll('.lc-row').length
  }
})()`

const ledgerBytes = async () => {
  const root = join(drive.profile, 'mission-ledger')
  try {
    const names = await readdir(root)
    let total = 0
    for (const name of names) {
      const info = await stat(join(root, name)).catch(() => undefined)
      if (info?.isFile() === true) total += info.size
    }
    return total
  } catch {
    return 0
  }
}

const trend = []

try {
  await drive.capture('launch, on the free OpenCode model', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren')).click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
  })

  for (let turn = 1; turn <= TURNS; turn += 1) {
    const started = Date.now()
    await drive.evaluate(
      sendAndWaitScript(`Turn ${String(turn)}: reply with exactly the word ACK${String(turn)} and nothing else.`, { waitSeconds: 300 })
    )
    const took = Date.now() - started
    const seen = await drive.evaluate(reading)
    trend.push({ turn, took, ...(typeof seen === 'object' && seen !== null ? seen : {}), ledger: await ledgerBytes() })
    // A picture every few turns rather than fifteen near-identical ones.
    if (turn === 1 || turn === Math.ceil(TURNS / 2) || turn === TURNS) {
      await drive.capture(`after turn ${String(turn)}`, () => {
        const last = trend.at(-1)
        return `${String(last?.took ?? 0)}ms · heap ${String(last?.heapMb ?? 'n/a')}MB · ${String(last?.nodes ?? 0)} nodes · thread ${String(last?.threadChars ?? 0)} chars · ledger ${String(Math.round((last?.ledger ?? 0) / 1024))}KB`
      })
    }
  }

  await drive.capture('the trend, first turn to last', () => {
    const first = trend[0]
    const last = trend.at(-1)
    const slowest = trend.reduce((held, entry) => (entry.took > held.took ? entry : held), trend[0])
    const line = (entry) =>
      `turn ${String(entry.turn)}: ${String(entry.took)}ms, heap ${String(entry.heapMb)}MB, ${String(entry.nodes)} nodes, ledger ${String(Math.round(entry.ledger / 1024))}KB`
    return [
      line(first),
      line(last),
      `slowest was turn ${String(slowest.turn)} at ${String(slowest.took)}ms`,
      `heap ${String(first.heapMb)} -> ${String(last.heapMb)}MB, nodes ${String(first.nodes)} -> ${String(last.nodes)}, thread ${String(first.threadChars)} -> ${String(last.threadChars)} chars`
    ].join(' || ')
  })

  await drive.capture('the sidebar and header after fifteen turns', () => drive.evaluate(`(() => {
    const sidebar = document.querySelector('.lc-sidebar')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 200) ?? ''
    const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 160) ?? ''
    return 'sidebar: ' + sidebar + ' || header: ' + header
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  say(JSON.stringify(trend))
  await drive.finish({
    intro: `Build: whatever \`pnpm build\` last wrote to out/. Wren on the free OpenCode model, ${String(TURNS)} turns in one conversation, measuring what each one costs.`
  })
}
