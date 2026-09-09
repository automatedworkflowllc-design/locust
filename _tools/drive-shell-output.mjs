// Can you see what a command printed?
//
//   LOCUST_SPEND=1 node _tools/drive-shell-output.mjs
//
// Found by `drive-huge-turn`: a teammate ran `seq 1 1200`, said "printed 1
// through 1200, one per line", and the row read `seq 1 1200 - bash - done`
// with not one of those lines anywhere. The adapter had CAPTURED the output --
// `aggregated_output` is in twelve recorded sessions on this machine -- and
// the activity entry threw it away.
//
// Only Codex's exec stream reports command output, so this is the only runtime
// that can verify the fix. Two attempts to avoid spending anything, by
// hand-writing a mission ledger and opening the app onto it, both failed: the
// mission recovers as INTERRUPTED and draws no tool row at all.
//
// So it spends, and it spends as little as it can: ONE turn, effort `low`
// (the only cost lever -- `model/list` reports exactly one Codex model), and
// 300 lines of output rather than 1,200. 300 still crosses the 200-line bound,
// which is the half that needed seeing.

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-shellout-ws-')
const drive = await startDrive({
  spends: true,
  name: 'shell-output',
  port: 9403,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{
      teammateId: 'tm_wren',
      name: 'Wren',
      hue: 'lime',
      role: 'Code & Migrations',
      createdAt: '2026-09-05T05:00:00.000Z',
      route: { runtime: 'codex', model: 'gpt-6-astra', mode: 'accept-edits', effort: 'low' }
    }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch, on Codex at the cheapest effort', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 700)) })()`)
    return drive.evaluate(`[...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')`)
  })

  await drive.capture('run one noisy command', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Mission instruction"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Run exactly this shell command and nothing else: seq 1 300. Then say DONE.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) return 'finished after ' + i + 's'
    }
    return 'STILL RUNNING after four minutes'
  })()`))

  await drive.capture('THE QUESTION: does the command row open', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-activity')
    if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 500))
    const shell = document.querySelector('.lc-filerow.is-shell')
    if (!shell) return 'NO SHELL ROW -- rows present: ' + [...document.querySelectorAll('.lc-filerow')].map(r => r.textContent?.trim().slice(0, 40)).join(' | ')
    return JSON.stringify({
      row: shell.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 70),
      opens: shell.tagName === 'BUTTON',
      // Static means the runtime reported no output. That is a real answer
      // too, and a different one from the feature being broken.
      staticBecauseNoOutput: shell.classList.contains('is-static')
    }, null, 1)
  })()`))

  await drive.capture('open it and read what the command printed', () => drive.evaluate(`(async () => {
    const shell = document.querySelector('.lc-filerow.is-shell')
    if (!shell || shell.tagName !== 'BUTTON') return 'the row does not open'
    shell.click()
    await new Promise(r => setTimeout(r, 600))
    const out = document.querySelector('.lc-shellout__text')
    if (!out) return 'NO OUTPUT DRAWN'
    const lines = (out.textContent ?? '').split(String.fromCharCode(10))
    return JSON.stringify({
      linesDrawn: lines.length,
      first: lines[0],
      last: lines[lines.length - 1],
      // Both ends, which is the whole rule.
      keptStart: lines.includes('1'),
      keptEnd: lines.includes('300'),
      saysWhatItOmitted: (document.querySelector('.lc-shellout__note')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 100)
    }, null, 1)
  })()`))

  await drive.capture('the output on screen', () => drive.evaluate(`'see the PNG'`))
} finally {
  await drive.finish({
    intro: 'One short Codex turn at low effort, running seq 1 300, to see whether a command row opens onto what the command printed.'
  })
}

say('done')
