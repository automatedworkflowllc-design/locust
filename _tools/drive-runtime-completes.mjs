// Does a Claude Code run reach a terminal state through the app?
//
//   node _tools/drive-claude-completes.mjs
//
// Five smokes fail with the same shape -- {"started":true,"done":false} -- on
// Claude, Cursor and Copilot: the run begins and never reports finishing.
// That is either a real regression in how the host reads those streams, or
// five stale harnesses. A drive settles it: one short Claude run, watched
// until it settles or the clock runs out, with the header's own words read
// back.
//
// Spends one small Claude Code run.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-rt-ws-')
const drive = await startDrive({
  name: process.argv[2] + '-completes',
  port: Number(process.argv[5] || 9324),
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture(`Wren on ${process.argv[2]} / ${process.argv[3]}`, async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 700))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/' + process.argv[2] + '/i', search: process.argv[3], row: '/^' + process.argv[4] + '/i' }))
  })

  await drive.capture('send, and watch until it settles', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word SETTLED and nothing else. Do not read any files.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    const seen = []
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ ]+/g, ' ') ?? ''
      const state = (header.match(/completed|failed|cancelled|running|Starting|stopped/i) ?? ['?'])[0]
      if (seen[seen.length - 1] !== state) seen.push(i + 's ' + state)
      if (/completed|failed|cancelled/i.test(header)) {
        const thread = document.querySelector('.lc-thread')?.innerText ?? ''
        return 'settled after ' + (i + 1) + 's :: ' + seen.join(' -> ')
          + ' || says SETTLED: ' + /SETTLED/.test(thread)
      }
    }
    const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ ]+/g, ' ') ?? ''
    return 'NEVER SETTLED in 300s :: ' + seen.join(' -> ') + ' || header: ' + header.slice(0, 160)
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One short Claude Code run, watched until it reaches a terminal state.' })
}
