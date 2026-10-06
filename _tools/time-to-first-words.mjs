// How long from Send to the reply's first words on screen, and to its end, on a free model (0.677).
//
//   node _tools/time-to-first-words.mjs [--packaged <exe>] [--runs 2] [--model opencode/<id>]
//
// 0.677 moved OpenCode from `run` onto its own server so replies stream. A server has to start before it answers;
// this measures what that costs and what streaming gives back: seconds to the first words, and to the whole reply.
// Run it on the build before and the build after. Spends nothing.

import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback)
const packaged = arg('--packaged')
const runs = Number(arg('--runs', '2'))
const model = arg('--model', FREE_ROUTE.model)
const ASK = 'Write a 120-word story about a lighthouse keeper. Plain prose, no headings.'

for (let run = 1; run <= runs; run += 1) {
  const drive = await startDrive({
    ...(packaged === undefined ? {} : { packaged }),
    name: `time-to-first-words-${String(run)}`, port: 9783, workspace: await scratchRepository('locust-first-words-'),
    outPath: join(recordRoot('time-to-first-words-2026-10-06'), `${packaged === undefined ? 'dev' : 'packaged'}-${String(run)}`),
    seed: {
      schemaVersion: 1,
      teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-10-06T00:00:00.000Z', route: { runtime: 'opencode', model, mode: 'ask' } }],
      missionOwners: {},
      settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
    }
  })
  try {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Wren'))
    const timing = JSON.parse(String(await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(ASK)})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 100))
        const send = document.querySelector('button[aria-label="Send"]')
        if (send && !send.disabled) { send.click(); break }
      }
      const sent = performance.now()
      let first
      for (let i = 0; i < 3000; i += 1) {
        await new Promise((r) => setTimeout(r, 100))
        const words = [...document.querySelectorAll('.lc-thread .lc-agentline__body')].map((el) => el.innerText.trim()).join(' ').length
        const running = Boolean(document.querySelector('button[aria-label^="Stop the running"]'))
        if (first === undefined && words > 20) first = performance.now()
        if (i > 10 && !running && words > 0) return JSON.stringify({ first: first === undefined ? null : Math.round((first - sent) / 100) / 10, end: Math.round((performance.now() - sent) / 100) / 10 })
      }
      return JSON.stringify({ first: null, end: null })
    })()`)))
    say(`run ${String(run)} (${packaged === undefined ? 'dev' : 'packaged'}, ${model}): first words ${String(timing.first)} s, whole reply ${String(timing.end)} s`)
  } finally {
    await drive.finish({ intro: 'time to first words', extra: '' })
  }
}
