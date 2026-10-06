// A streamed reply arrives whole, batched (0.630).
//
//   node _tools/drive-a-streamed-reply-arrives-whole.mjs [--packaged <exe>] [--tag <name>]
//
// 0.630 batches a reply's fragments for up to 50 ms before they are written to the record and sent to the
// window (exec/streaming-cost: 1,005 writes became 45 for a 1,000-fragment reply). The rule that must not
// move: every fragment is written before it is shown, and none is lost or reordered. On the free OpenCode
// model (spends nothing), Wren is asked for a 250-word story in Ask; when the turn ends, the reply on screen
// must be the reply in the record, character for character, and it must have grown while it streamed.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-streamed-whole-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-streamed-reply-arrives-whole-${tag}`, port: 9929, workspace,
  outPath: join(recordRoot('a-streamed-reply-arrives-whole-2026-10-05'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-05T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const normal = (text) => text.replace(/\s+/g, ' ').trim()
try {
  await drive.ready()
  await drive.resize(1200, 780)
  await drive.evaluate(openTeammateScript('Wren'))
  // Watch the reply grow while it streams: a few readings of the newest message's length.
  const growth = []
  const watching = (async () => {
    for (let i = 0; i < 120; i += 1) {
      await sleep(500)
      const length = Number(await drive.evaluate(`(() => { const all = [...document.querySelectorAll('.lc-thread .lc-agentline__body')]; return all.at(-1)?.innerText.length ?? 0 })()`))
      if (growth.at(-1) !== length) growth.push(length)
      const running = Boolean(await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`))
      if (!running && i > 6) break
    }
  })()
  await drive.capture('Wren writes a 250-word story', () => drive.evaluate(sendAndWaitScript('Write a 250-word story about a lighthouse keeper who finds a message in a bottle. Plain prose, no headings, no lists.', { waitSeconds: 300 })))
  await watching
  await sleep(2000)
  const shown = String(await drive.evaluate(`(() => { const all = [...document.querySelectorAll('.lc-thread .lc-agentline__body')]; return all.at(-1)?.innerText ?? '' })()`))
  // The record's reply: the run's message fragments, joined in order.
  const ledgerDir = join(drive.profile, 'mission-ledger')
  const files = (await readdir(ledgerDir)).filter((name) => name.endsWith('.jsonl'))
  let recorded = ''
  // How the reply reached the record: its writes, and the seconds between the first and the last.
  const writes = []
  for (const file of files) {
    const items = new Map()
    for (const line of (await readFile(join(ledgerDir, file), 'utf8')).split('\n')) {
      if (!line.trim()) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      const event = row.event
      if (row.recordType !== 'mission.event' || event?.type !== 'message.delta') continue
      const { itemId, operation, text } = event.payload
      items.set(itemId, operation === 'replace' ? text : `${items.get(itemId) ?? ''}${text}`)
      writes.push(Date.parse(event.occurredAt))
    }
    const last = [...items.values()].at(-1)
    if (last !== undefined && last.length > recorded.length) recorded = last
  }
  const spread = writes.length < 2 ? 0 : (Math.max(...writes) - Math.min(...writes)) / 1000
  say(`shown ${String(shown.length)} chars, recorded ${String(recorded.length)} chars, growth ${JSON.stringify(growth.slice(0, 12))}`)
  say(`  the record: ${String(writes.length)} write(s) of the reply over ${spread.toFixed(1)} s`)
  check('the reply is a real story (over 600 characters)', recorded.length > 600, String(recorded.length))
  check('the reply on screen is the reply in the record, word for word', normal(shown) === normal(recorded), `${normal(shown).slice(0, 80)} | ${normal(recorded).slice(0, 80)}`)
  /*
   * Growth only where the reply arrived in pieces. OpenCode's `run` route hands
   * over a text part once it has ended (only Approve each goes through its
   * server, which could stream), so a model that answers in one part reaches
   * the record in one write: Longcat and Fledge Alpha, 2026-10-06, 1 write each.
   * That is not this drive's question; the batching it guards is.
   */
  if (writes.length >= 3) check('it grew on screen while it streamed', growth.filter((length) => length > 0).length >= 3, JSON.stringify(growth))
  else say(`  (not checked: the runtime sent the reply in ${String(writes.length)} write(s), so there was nothing to watch grow)`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A free-model reply streamed, then compared with its record.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
