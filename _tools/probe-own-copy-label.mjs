// The new-teammate form's Own copy switch, read as drawn (0.519 plain words). Sends nothing.
//
//   node _tools/probe-own-copy-label.mjs [--packaged <exe>]

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = await scratchRepository('locust-probe-own-copy-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'own-copy-label',
  port: 9840,
  workspace,
  sendsNothing: true,
  outPath: join(recordRoot('own-copy-label-2026-10-01'), packaged === undefined ? 'local' : 'packaged'),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})
try {
  await drive.ready()
  const seen = await drive.capture('the Own copy switch', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 40 && !document.querySelector('[role=switch][aria-label="Own copy"]'); i += 1) {
      ;[...document.querySelectorAll('button')].find((b) => /New teammate/.test(b.innerText))?.click()
      await new Promise((r) => setTimeout(r, 500))
    }
    const sw = document.querySelector('[role=switch][aria-label="Own copy"]')
    sw?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 300))
    return sw ? (sw.closest('.lc-field')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'switch, no text') : 'no Own copy switch'
  })()`))
  say(`  ${String(seen)}`)
  say(/^Own copy Works in its own copy of the folder/i.test(String(seen)) ? 'ALL CHECKS PASSED' : '1 CHECK(S) FAILED')
} finally {
  await drive.finish({ intro: 'The Own copy switch on the new-teammate form.', extra: '' })
}
